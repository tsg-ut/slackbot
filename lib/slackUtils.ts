import type {MrkdwnElement, PlainTextElement} from '@slack/web-api';
import type {Member} from '@slack/web-api/dist/response/UsersListResponse';
import {WebClient} from '@slack/web-api';
import type {RTMClient} from '@slack/rtm-api';
import {getTokens, getRtmClient} from './slack';
import {Deferred} from './utils';
import SlackCache from './slackCache';

const slackCaches = new Map<string, SlackCache>();
const initializedSlackCachesDeferred = new Deferred<void>();

// Immediately Invoked Function Expression
(function initializedSlackCaches() {
	getTokens().then(async (tokens) => {
		for (const token of tokens) {
			const rtmClient: RTMClient = await getRtmClient(token.team_id);
			slackCaches.set(token.team_id, new SlackCache({
				token,
				rtmClient,
				webClient: new WebClient,
				enableUsers: true,
				enableEmojis: true,
				enableReactions: token.team_id === process.env.TEAM_ID,
			}));
		}
		initializedSlackCachesDeferred.resolve();
	});
})();

// Note: support only TSG
export const getReactions = async (channel: string, ts: string) => {
	await initializedSlackCachesDeferred.promise;
	return slackCaches.get(process.env.TEAM_ID!)!.getReactions(channel, ts);
};

export const getAllTSGMembers = async (): Promise<Array<Member>> => {
	await initializedSlackCachesDeferred.promise;
	return Array.from(await slackCaches.get(process.env.TEAM_ID!)!.getUsers());
};

export const getMemberName = async (user: string): Promise<string|undefined> => {
	await initializedSlackCachesDeferred.promise;

	// TODO: receive team_id and use it to choose slackCache
	let member: Member|null = null;
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
export const getMemberIcon = async (user: string, res: IconResolution = 24): Promise<string|undefined> => {
	await initializedSlackCachesDeferred.promise;

	// TODO: receive team_id and use it to choose slackCache
	let member: Member|null = null;
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

export const getEmoji = async (name: string, team: string): Promise<string|undefined> => {
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
