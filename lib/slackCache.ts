import {get} from 'lodash';
import type {RTMClient} from '@slack/rtm-api';
import type {Reaction} from '@slack/web-api/dist/response/ConversationsHistoryResponse';
import type {Member} from '@slack/web-api/dist/response/UsersListResponse';
import type {Token} from '../oauth/tokens';
import {Deferred} from './utils';
import logger from './logger';

import type {
	ConversationsHistoryArguments,
	UsersListArguments,
	EmojiListArguments,
} from '@slack/web-api/dist/methods';
import type {
	ConversationsHistoryResponse,
	UsersListResponse,
	EmojiListResponse,
} from '@slack/web-api/dist/response';

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
	rtmClient: RTMClient;
	webClient: WebClient;
	enableUsers?: boolean;
	enableEmojis?: boolean;
	enableReactions?: boolean;
}

export default class SlackCache {
	private config: Config;
	private users = new Map<string, Member>();
	private emojis = new Map<string, string>();
	// Cache for message reactions. Currently it only holds counts of reactions.
	private reactionsCache = new Map<string, Record<string, number>>();
	private loadUsersDeferred = new Deferred<void>();
	private loadEmojisDeferred = new Deferred<void>();

	constructor(config: Config) {
		this.config = config;

		if (this.config.enableUsers) {
			this.config.rtmClient.on('team_join', ({user}: {user: Member}) => {
				this.users.set(user.id!, user);
			});
			this.config.rtmClient.on('user_change', ({user}: {user: Member}) => {
				this.users.set(user.id!, user);
			});

			this.config.webClient.users.list({token: this.config.token.bot_access_token})
				.then(({members}) => {
					for (const member of members!) {
						this.users.set(member.id!, member);
					}
				})
				.then(() => this.loadUsersDeferred.resolve())
				.catch((err: any) => logger.error(`SlackCache/users.list(${this.config.token.team_id})`,  err));
		}

		if (this.config.enableEmojis) {
			this.config.rtmClient.on('emoji_changed', async (event) => {
				if (event.subtype === 'add') {
					this.emojis.set(event.name, event.value);
				}
			});
			// TODO: should be bot access token after migration to new OAuth Scope.
			// FIXME: node-slack-sdkの型情報ミスってない？そんなことない？なんでas要るの？
			(this.config.webClient.emoji.list({token: this.config.token.access_token}) as Promise<{emoji: any}>)
				.then(({emoji: emojis}: {emoji: any}) => {
					for (const name in emojis) {
						this.emojis.set(name, emojis[name]);
					}
				})
				.then(() => this.loadEmojisDeferred.resolve())
				.catch((err: any) => logger.error(`SlackCache/emoji.list(${this.config.token.team_id})`,  err));
		}

		if (this.config.enableReactions) {
			this.config.rtmClient.on('message', (message) => {
				const key = `${message.channel}\0${message.ts}`;
				if (!this.reactionsCache.has(key)) {
					this.reactionsCache.set(key, Object.create(null));
				}
			});
			this.config.rtmClient.on('reaction_added', async (event) => {
				this.incrementReactions({
					channel: event.item.channel,
					ts: event.item.ts,
					reaction: event.reaction,
					by: 1,
				});
			});
			this.config.rtmClient.on('reaction_removed', (event) => {
				this.incrementReactions({
					channel: event.item.channel,
					ts: event.item.ts,
					reaction: event.reaction,
					by: -1,
				});
			});
		}
	}
	public async getUsers(): Promise<IterableIterator<Member>> {
		if (!this.config.enableUsers) {
			throw new Error('usersCache disabled');
		}
		await this.loadUsersDeferred.promise;
		return this.users.values();
	}

	public async getUser(user: string): Promise<Member|undefined> {
		if (!this.config.enableUsers) {
			throw new Error('usersCache disabled');
		}
		await this.loadUsersDeferred.promise;
		return this.users.get(user);
	}

	public async getEmoji(emoji: string): Promise<string|undefined> {
		if (!this.config.enableEmojis) {
			throw new Error('emojisCache disabled');
		}
		await this.loadEmojisDeferred.promise;
		return this.emojis.get(emoji);
	}

	public async getReactions(channel: string, ts: string): Promise<Record<string,number>|undefined> {
		if (!this.config.enableReactions) {
			throw new Error('reactionsCache disabled');
		}
		const key = `${channel}\0${ts}`;
		if (this.reactionsCache.has(key)) {
			return this.reactionsCache.get(key);
		}

		const data = await this.config.webClient.conversations.history({
			token: this.config.token.access_token,
			channel: channel,
			latest: ts,
			limit: 1,
			inclusive: true,
		});

		// race condition
		if (this.reactionsCache.has(key)) {
			return this.reactionsCache.get(key);
		}

		const remoteReactions: Reaction[] = get(data, ['messages', 0, 'reactions'], [] as Reaction[]);
		const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => (
			[reaction.name, reaction.count]
		)));
		this.reactionsCache.set(key, remoteReactionsObj);
		return remoteReactionsObj;
	}

	private async incrementReactions({
		channel,
		ts,
		reaction,
		by,
	}: {
		channel: string,
		ts: string,
		reaction: string,
		by: number,
	}): Promise<void> {
		const key = `${channel}\0${ts}`;

		{
			const reactions = this.reactionsCache.get(key);
			if (reactions) {
				if (!{}.hasOwnProperty.call(reactions, reaction)) {
					reactions[reaction] = 0;
				}
				reactions[reaction] += by;
				return;
			}
		}

		const data = await this.config.webClient.conversations.history({
			token: this.config.token.access_token,
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
					reactions[reaction] = 0;
				}
				reactions[reaction] += by;
				return;
			}
		}

		const remoteReactions: Reaction[] = get(data, ['messages', 0, 'reactions'], [] as Reaction[]);
		const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => (
			[reaction.name, reaction.count]
		)));
		this.reactionsCache.set(key, remoteReactionsObj);
		return;
	}
}