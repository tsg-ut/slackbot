import {get} from 'lodash';
import type {Token} from '../oauth/tokens';
import {Deferred} from './utils';
import {TeamEventClient} from './slackEventClient';
import _logger from './logger';

import type {SlackEventAdapter} from '@slack/events-api';
import type {Reaction} from '@slack/web-api/dist/response/ConversationsHistoryResponse';
import type {Member} from '@slack/web-api/dist/response/UsersListResponse';
import type {
	ConversationsHistoryArguments,
	ConversationsHistoryResponse,
	UsersListArguments,
	UsersListResponse,
	EmojiListArguments,
	EmojiListResponse,
} from '@slack/web-api';

const logger = _logger.child({bot: 'lib/slackCache'});

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
	eventClient: SlackEventAdapter;
	webClient: WebClient;
	enableReactions?: boolean;
}

export default class SlackCache {
	private config: Config;
	private users = new Map<string, Member>();
	private emojis = new Map<string, string>();
	// Cache for message reactions. This property holds user IDs who reacted to a message,
	// ordered by the time of reaction.
	private reactionsCache = new Map<string, Record<string, string[]>>();
	private loadUsersDeferred = new Deferred<void>();
	private loadEmojisDeferred = new Deferred<void>();

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
				.catch((err: any) => logger.error(`SlackCache/users.list(${this.config.token.team_id}): ${err}`, err));
		}

		{
			// emoji cache
			teamEventClient.on('emoji_changed', async (event) => {
				if (event.subtype === 'add') {
					this.emojis.set(event.name, event.value);
				}
			});
			// FIXME: node-slack-sdkの型情報ミスってない？そんなことない？なんでas要るの？
			(this.config.webClient.emoji.list({token: this.config.token.bot_access_token}) as Promise<{emoji: any}>)
				.then(({emoji: emojis}: {emoji: any}) => {
					for (const name in emojis) {
						this.emojis.set(name, emojis[name]);
					}
				})
				.then(() => this.loadEmojisDeferred.resolve())
				.catch((err: any) => logger.error(`SlackCache/emoji.list(${this.config.token.team_id}): ${err}`, err));
		}

		if (this.config.enableReactions) {
			teamEventClient.on('message', (message) => {
				const key = `${message.channel}\0${message.ts}`;
				if (!this.reactionsCache.has(key)) {
					this.reactionsCache.set(key, Object.create(null));
				}
			});
			teamEventClient.on('reaction_added', (event) => {
				return this.modifyReaction({
					type: 'add',
					channel: event.item.channel,
					ts: event.item.ts,
					reaction: event.reaction,
					user: event.user,
				});
			});
			teamEventClient.on('reaction_removed', (event) => {
				return this.modifyReaction({
					type: 'remove',
					channel: event.item.channel,
					ts: event.item.ts,
					reaction: event.reaction,
					user: event.user,
				});
			});
		}
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
		await this.loadEmojisDeferred.promise;
		return this.emojis.get(emoji);
	}

	public async getReactions(channel: string, ts: string): Promise<Record<string, string[]>> {
		if (!this.config.enableReactions) {
			throw new Error('reactionsCache disabled');
		}
		const key = `${channel}\0${ts}`;
		{
			const reactions = this.reactionsCache.get(key);
			if (reactions) {
				return reactions;
			}
		}

		const data = await this.config.webClient.conversations.history({
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

		const data = await this.config.webClient.conversations.history({
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
