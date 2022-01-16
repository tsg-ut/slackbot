import {MrkdwnElement, PlainTextElement, WebClient} from '@slack/web-api';
import type {SlackEventAdapter} from '@slack/events-api';
import type {Reaction} from '@slack/web-api/dist/response/ConversationsHistoryResponse';
import {flatten, get} from 'lodash';
import {getTokens} from './slack';
import {Deferred} from './utils';
import logger from './logger';
import type {Token} from '../oauth/tokens';

const webClient = new WebClient();

const additionalMembers: any[] = [];
const additionalEmojis: any[] = [];

const loadMembersDeferred = new Deferred<Array<any>>();
const loadEmojisDeferred = new Deferred<Array<any>>();
const tokensDeferred = new Deferred<Token[]>();

// Cache for message reactions. Currently it only holds counts of reactions.
const reactionsCache = new Map<string, Record<string, number>>();

export const initilizeEventClient = (eventClient: SlackEventAdapter) => {
		const incrementReactions = async ({team_id, channel, ts, reaction, by}: {team_id: string, channel: string, ts: string, reaction: string, by: number}) => {
			const key = `${channel}\0${ts}`;

			if (reactionsCache.has(key)) {
				const reactions = reactionsCache.get(key);
				if (!{}.hasOwnProperty.call(reactions, reaction)) {
					reactions[reaction] = 0;
				}
				reactions[reaction] += by;
				return;
			}

			const token = (await getTokens()).find(({team_id: tid}) => team_id === tid);
			if (!token) {
				logger.warn(`slackUtils: unknown team: ${team_id}`);
				return;
			}

			const data = await webClient.conversations.history({
				token: token.access_token,
				channel: channel,
				latest: ts,
				limit: 1,
				inclusive: true,
			});

			// race condition
			if (reactionsCache.has(key)) {
				const reactions = reactionsCache.get(key);
				if (!{}.hasOwnProperty.call(reactions, reaction)) {
					reactions[reaction] = 0;
				}
				reactions[reaction] += by;
				return;
			}

			const remoteReactions = get(data, ['messages', 0, 'reactions'], [] as Reaction[]);
			const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => (
				[reaction.name, reaction.count]
			)));
			reactionsCache.set(key, remoteReactionsObj);
			return;
		}

		eventClient.on('team_join', (event) => {
			additionalMembers.unshift(event.user);
		});
		eventClient.on('user_change', (event) => {
			additionalMembers.unshift(event.user);
		});
		eventClient.on('emoji_changed', async (event) => {
			if (event.subtype === 'add') {
				additionalEmojis.unshift({
					team: event.team_id,
					name: event.name,
					url: event.value,
				});
			}
		});
		eventClient.on('message', (message) => {
			const key = `${message.channel}\0${message.ts}`;
			if (!reactionsCache.has(key)) {
				reactionsCache.set(key, Object.create(null));
			}
		});
		eventClient.on('reaction_added', async (event) => {
			incrementReactions({
				team_id: event.team_id,
				channel: event.item.channel,
				ts: event.item.ts,
				reaction: event.reaction,
				by: 1,
			});
		});
		eventClient.on('reaction_removed', (event) => {
			incrementReactions({
				team_id: event.team_id,
				channel: event.item.channel,
				ts: event.item.ts,
				reaction: event.reaction,
				by: -1,
			});
		});
};


getTokens().then(async (tokens) => {
	tokensDeferred.resolve(tokens);

	Promise.all(tokens.map(async (token) => {
		try {
			const {members} = await webClient.users.list({token: token.bot_access_token});
			return members;
		} catch (error) {
			console.error(`Error loading members for team ${token.team_name}:`, error);
			return [];
		}
	})).then((usersArray) => {
		loadMembersDeferred.resolve(flatten(usersArray));
	});

	Promise.all(tokens.map(async (token) => {
		try {
			const {emoji}: any = await webClient.emoji.list({token: token.access_token});
			const {team}: any = await webClient.team.info({token: token.bot_access_token});
			return Object.entries(emoji).map(([name, url]) => ({
				team: team.id,
				name,
				url,
			}));
		} catch (error) {
			console.error(`Error loading emojis for team ${token.team_name}:`, error);
			return [];
		}
	})).then((emojisArray) => {
		loadEmojisDeferred.resolve(flatten(emojisArray));
	});
});

export const getReactions = async (channel: string, ts: string) => {
	// reaction_addedイベントの中から呼ばれても安全なように常にnextTickを待つ
	await new Promise(process.nextTick);

	const key = `${channel}\0${ts}`;
	if (reactionsCache.has(key)) {
		return reactionsCache.get(key);
	}

	const tokens = await tokensDeferred.promise;
	const token = tokens.find((token) => token.team_id === process.env.TEAM_ID);
	if (!token) {
		throw new Error('Available token not found');
	}

	const data = await webClient.conversations.history({
		token: token.access_token,
		channel: channel,
		latest: ts,
		limit: 1,
		inclusive: true,
	});

	// race condition
	if (reactionsCache.has(key)) {
		return reactionsCache.get(key);
	}

	const remoteReactions = get(data, ['messages', 0, 'reactions'], [] as Reaction[]);
	const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => (
		[reaction.name, reaction.count]
	)));
	reactionsCache.set(key, remoteReactionsObj);
	return remoteReactionsObj;
};

export const getAllMembers = async (): Promise<Array<any>> => {
	return [
		...additionalMembers,
		...(await loadMembersDeferred.promise),
	];
};

export const getMemberName = async (user: string): Promise<string> => {
	const members = [
		...additionalMembers,
		...(await loadMembersDeferred.promise),
	];
	const member = members.find(({id}: any) => id === user);
	return member.profile.display_name || member.profile.real_name || member.name;
};

type IconResolution = 24 | 32 | 48 | 72 | 192 | 512;
export const getMemberIcon = async (user: string, res: IconResolution = 24): Promise<string> => {
	const members = [
		...additionalMembers,
		...(await loadMembersDeferred.promise),
	];
	const member = members.find(({id}: any) => id === user);
	switch (res) {
		case 32:
			return member.profile.image_32;
		case 48:
			return member.profile.image_48;
		case 72:
			return member.profile.image_72;
		case 192:
			return member.profile.image_192;
		case 512:
			return member.profile.image_512;
		default:
			return member.profile.image_24;
	}
};

export const getEmoji = async (name: string, team: string): Promise<string> => {
	const emojis = [
		...additionalEmojis,
		...(await loadEmojisDeferred.promise),
	];
	const emoji = emojis.find((emoji: any) => emoji.name === name && emoji.team === team);
	return emoji ? emoji.url : undefined;
};

export const plainText = (text: string, emoji: boolean = true): PlainTextElement => ({
	type: 'plain_text' as 'plain_text',
	text,
	emoji,
});

export const mrkdwn = (text: string): MrkdwnElement => ({
	type: 'mrkdwn' as 'mrkdwn',
	text,
});
