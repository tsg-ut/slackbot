import {get} from 'lodash';
import type EventEmitter from 'events';
import type {Token} from '../oauth/tokens';
import {Deferred} from './utils';
import {TeamEventClient} from './slackEventClient';
import {conversationsHistory} from './slackPatron';
import logger from './logger';

import type {Reaction} from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type {Member} from '@slack/web-api/dist/types/response/UsersListResponse';
import type {
	ConversationsHistoryArguments,
	ConversationsHistoryResponse,
	UsersListArguments,
	UsersListResponse,
	EmojiListArguments,
	EmojiListResponse,
	EmojiChangedEvent,
	ReactionAddedEvent,
	ReactionRemovedEvent,
} from '@slack/web-api';

const log = logger.child({bot: 'lib/slackCache'});

interface WebClient {
	users: {
		list(args: UsersListArguments): Promise<UsersListResponse>;
	};
	emoji: {
		list(args: EmojiListArguments): Promise<EmojiListResponse>;
	};
	conversations: {
		history(args: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse>;
	};
}

interface Config {
	token: Token;
	eventClient: EventEmitter;
	webClient: WebClient;
}

const TSG_TEAM_ID = process.env.TEAM_ID || 'T00000000';

export default class SlackCache {
	private readonly config: Config;
	private users = new Map<string, Member>();
	private emojis = new Map<string, string>();
	// Cache for message reactions. This property holds user IDs who reacted to a message,
	// ordered by the time of reaction.
	private reactionsCache = new Map<string, Record<string, string[]>>();
	private loadUsersDeferred = new Deferred<void>();
	private loadEmojisPromise: Promise<void> | null = null;
	private emojiUpdates: Promise<void> = Promise.resolve();

	constructor(config: Config) {
		this.config = config;
		const teamEventClient = new TeamEventClient(this.config.eventClient, this.config.token.team_id);

		{
			// user cache
			teamEventClient.on('team_join', ({user}: {user: Member}) => {
				this.users.set(user.id!, user);
			});
			teamEventClient.on('user_change', ({user}: {user: Member}) => {
				this.users.set(user.id!, user);
			});

			this.config.webClient.users.list({token: this.config.token.bot_access_token})
				.then(({members}) => {
					for (const member of members!) {
						this.users.set(member.id!, member);
					}
				})
				.then(() => this.loadUsersDeferred.resolve())
				.catch((err: any) => log.error(`SlackCache/users.list(${this.config.token.team_id}): ${err}`, err));
		}

		{
			// emoji cache
			teamEventClient.on('emoji_changed', (event: EmojiChangedEvent) => {
				this.emojiUpdates = this.emojiUpdates.then(() => this.updateEmojis(event))
					.catch((error: unknown) => {
						log.error('Failed to update emoji cache', {error});
					});
			});
			void this.loadEmojis().catch((error: unknown) => log.error(`SlackCache/emoji.list(${this.config.token.team_id})`, {error}));
		}

		teamEventClient.on('message', (message) => {
			const key = `${message.channel}\0${message.ts}`;
			if (!this.reactionsCache.has(key)) {
				this.reactionsCache.set(key, Object.create(null));
			}
		});
		teamEventClient.on(
			'reaction_added',
			(event: ReactionAddedEvent) => (
				this.modifyReaction({
					type: 'add',
					channel: event.item.channel,
					ts: event.item.ts,
					reaction: event.reaction,
					user: event.user,
				})
			),
		);
		teamEventClient.on(
			'reaction_removed',
			(event: ReactionRemovedEvent) => (
				this.modifyReaction({
					type: 'remove',
					channel: event.item.channel,
					ts: event.item.ts,
					reaction: event.reaction,
					user: event.user,
				})
			),
		);
	}
	public async getUsers(): Promise<Member[]> {
		await this.loadUsersDeferred.promise;
		return Array.from(this.users.values());
	}

	public async getUser(user: string): Promise<Member|undefined> {
		await this.loadUsersDeferred.promise;
		return this.users.get(user);
	}

	public async getEmoji(emoji: string): Promise<string|undefined> {
		await this.loadEmojis();
		await this.emojiUpdates;
		return this.emojis.get(emoji);
	}

	public async getEmojis(): Promise<Record<string, string>> {
		await this.loadEmojis();
		await this.emojiUpdates;
		return Object.fromEntries(this.emojis);
	}

	private loadEmojis(): Promise<void> {
		if (!this.loadEmojisPromise) {
			this.loadEmojisPromise = this.config.webClient.emoji.list({token: this.config.token.bot_access_token})
				.then(({emoji}) => {
					this.emojis = new Map(Object.entries(emoji ?? {}));
				})
				.catch((error: unknown) => {
					this.loadEmojisPromise = null;
					throw error;
				});
		}
		return this.loadEmojisPromise;
	}

	private async updateEmojis(event: EmojiChangedEvent): Promise<void> {
		// Apply events after the initial snapshot so that it cannot overwrite newer changes.
		await this.loadEmojis();
		if (event.subtype === 'add' && event.name && event.value) {
			this.emojis.set(event.name, event.value);
		} else if (event.subtype === 'remove' && event.names) {
			const removed = new Set(event.names);
			let changed = true;
			while (changed) {
				changed = false;
				for (const [name, value] of this.emojis) {
					if (removed.has(name) || (value.startsWith('alias:') && removed.has(value.slice('alias:'.length)))) {
						removed.add(name);
						this.emojis.delete(name);
						changed = true;
					}
				}
			}
		} else if (event.subtype === 'rename' && event.old_name && event.new_name) {
			const value = event.value ?? this.emojis.get(event.old_name);
			this.emojis.delete(event.old_name);
			if (value !== undefined) {
				this.emojis.set(event.new_name, value);
			}
			for (const [name, target] of this.emojis) {
				if (target === `alias:${event.old_name}`) {
					this.emojis.set(name, `alias:${event.new_name}`);
				}
			}
		} else {
			this.loadEmojisPromise = null;
			await this.loadEmojis();
		}
	}

	public async getReactions(channel: string, ts: string): Promise<Record<string, string[]>> {
		const key = `${channel}\0${ts}`;
		{
			const reactions = this.reactionsCache.get(key);
			if (reactions) {
				return reactions;
			}
		}

		if (this.config.token.team_id !== TSG_TEAM_ID) {
			// conversationsHistoryはslack-patronを呼び出している都合上、
			// TSGチーム以外のチームでは利用できない。諦める。
			return {};
		}

		const data = await conversationsHistory({
			token: this.config.token.bot_access_token,
			channel: channel,
			latest: ts,
			limit: 1,
			inclusive: true,
		});

		{
			// race condition
			const reactions = this.reactionsCache.get(key);
			if (reactions) {
				return reactions;
			}
		}

		const remoteReactions: Reaction[] = get(data, ['messages', 0, 'reactions'], [] as Reaction[]);
		const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => (
			[reaction.name, reaction.users ?? []]
		)));
		this.reactionsCache.set(key, remoteReactionsObj);
		return remoteReactionsObj;
	}

	private async modifyReaction({
		channel,
		ts,
		reaction,
		user,
		type,
	}: {
		channel: string,
		ts: string,
		reaction: string,
		user: string,
		type: 'add' | 'remove',
	}): Promise<void> {
		const key = `${channel}\0${ts}`;

		if (this.config.token.team_id !== TSG_TEAM_ID && !this.reactionsCache.has(key)) {
			// conversationsHistoryはslack-patronを呼び出している都合上
			// TSGチーム以外のチームでは利用できない。
			// 空のオブジェクトを初期状態として仮定する。
			this.reactionsCache.set(key, Object.create(null));
		}

		{
			const reactions = this.reactionsCache.get(key);
			if (reactions) {
				if (!{}.hasOwnProperty.call(reactions, reaction)) {
					reactions[reaction] = [];
				}
				if (type === 'add') {
					if (!reactions[reaction].includes(user)) {
						reactions[reaction].push(user);
					}
				} else {
					const index = reactions[reaction].indexOf(user);
					if (index !== -1) {
						reactions[reaction].splice(index, 1);
					}
				}
				return;
			}
		}

		const data = await conversationsHistory({
			token: this.config.token.bot_access_token,
			channel: channel,
			latest: ts,
			limit: 1,
			inclusive: true,
		});

		{
			// race condition
			const reactions = this.reactionsCache.get(key);
			if (reactions) {
				if (!{}.hasOwnProperty.call(reactions, reaction)) {
					reactions[reaction] = [];
				}
				if (type === 'add') {
					if (!reactions[reaction].includes(user)) {
						reactions[reaction].push(user);
					}
				} else {
					const index = reactions[reaction].indexOf(user);
					if (index !== -1) {
						reactions[reaction].splice(index, 1);
					}
				}
				return;
			}
		}

		const remoteReactions: Reaction[] = get(data, ['messages', 0, 'reactions'], [] as Reaction[]);
		const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => (
			[reaction.name, reaction.users ?? []]
		)));
		this.reactionsCache.set(key, remoteReactionsObj);
		return;
	}
}
