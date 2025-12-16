import type { MrkdwnElement, PlainTextElement } from '@slack/web-api';
import type { Member } from '@slack/web-api/dist/types/response/UsersListResponse';
import { WebClient } from '@slack/web-api';
import { eventClient, getTokens } from './slack';
import { Deferred } from './utils';
import SlackCache from './slackCache';
import type { GenericMessageEvent, MessageEvent } from '@slack/bolt';
import os from 'os';

const slackCaches = new Map<string, SlackCache>();
const initializedSlackCachesDeferred = new Deferred<void>();

// Immediately Invoked Function Expression
(async function initializedSlackCaches() {
	const tokens = await getTokens();
	for (const token of tokens) {
		slackCaches.set(token.team_id, new SlackCache({
			token,
			eventClient,
			webClient: new WebClient(),
		}));
	}
	initializedSlackCachesDeferred.resolve();
})();

export const getReactions = async (channel: string, ts: string, team: string = process.env.TEAM_ID!) => {
	await initializedSlackCachesDeferred.promise;
	const slackCache = slackCaches.get(team);
	if (!slackCache) {
		throw new Error(`Slack cache for team ${team} not found`);
	}
	return slackCache.getReactions(channel, ts);
};

export const getAllTSGMembers = async (): Promise<Array<Member>> => {
	await initializedSlackCachesDeferred.promise;
	return await slackCaches.get(process.env.TEAM_ID!)!.getUsers();
};

export const getMemberName = async (user: string): Promise<string | undefined> => {
	await initializedSlackCachesDeferred.promise;

	// TODO: receive team_id and use it to choose slackCache
	let member: Member | null = null;
	for (const caches of slackCaches.values()) {
		const found = await caches.getUser(user);
		if (found) {
			member = found;
			break;
		}
	}

	return member?.profile?.display_name || member?.profile?.real_name || member?.name;
};

type IconResolution = 24 | 32 | 48 | 72 | 192 | 512;
export const getMemberIcon = async (user: string, res: IconResolution = 24): Promise<string | undefined> => {
	await initializedSlackCachesDeferred.promise;

	// TODO: receive team_id and use it to choose slackCache
	let member: Member | null = null;
	for (const caches of slackCaches.values()) {
		const found = await caches.getUser(user);
		if (found) {
			member = found;
			break;
		}
	}
	if (!member) {
		return undefined;
	}
	switch (res) {
		case 32:
			return member.profile?.image_32;
		case 48:
			return member.profile?.image_48;
		case 72:
			return member.profile?.image_72;
		case 192:
			return member.profile?.image_192;
		case 512:
			return member.profile?.image_512;
		default:
			return member.profile?.image_24;
	}
};

export const getEmoji = async (name: string, team: string): Promise<string | undefined> => {
	await initializedSlackCachesDeferred.promise;
	return slackCaches.get(team)?.getEmoji(name);
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

const isGenericMessage = (message: MessageEvent): message is GenericMessageEvent => (
	message.subtype === undefined
);

export const extractMessage = (message: MessageEvent) => {
	if (isGenericMessage(message)) {
		return message;
	}
	if (message.subtype === 'bot_message') {
		return message;
	}
	if (message.subtype === 'thread_broadcast') {
		return message.root;
	}
	return null;
};

export const getAuthorityLabel = () => {
	if (process.env.NODE_ENV === 'production') {
		return 'production';
	}

	if (process.env.GITHUB_USER && process.env.CODESPACE_NAME) {
		const abbreviatedCodespaceName = process.env.CODESPACE_NAME.split('-')[0] + '-…';
		return `Codespaces (@${process.env.GITHUB_USER}): ${abbreviatedCodespaceName}`;
	}

	const username = process.env.GITHUB_USER || process.env.USER || process.env.USERNAME || os.userInfo()?.username || 'unknown';
	const hostname = process.env.CODESPACE_NAME || os.hostname() || 'unknown';
	return `${username}@${hostname}`;
};

/**
 * 指定された Channel ID のチャンネルがゲームの起動を意図されたチャンネルかどうかを判定する
 */
export function isPlayground(channelId: string) {
	const playgroundChannels = [
		process.env.CHANNEL_SANDBOX,
		process.env.CHANNEL_GAMES,
	].filter(Boolean);
	return playgroundChannels.includes(channelId);
}
