import {WebClient} from '@slack/web-api';
import {flatten} from 'lodash';
import {getTokens, getRtmClient} from './slack';
import {Deferred} from './utils';

const webClient = new WebClient();

const additionalMembers: any[] = [];
const additionalEmojis: any[] = [];

const loadMembersDeferred = new Deferred();
const loadEmojisDeferred = new Deferred();

getTokens().then(async (tokens) => {
	for (const token of tokens) {
		const rtmClient = await getRtmClient(token.team_id);
		rtmClient.on('team_join', (event) => {
			additionalMembers.unshift(event.user);
		});
		rtmClient.on('user_change', (event) => {
			additionalMembers.unshift(event.user);
		});
		rtmClient.on('emoji_changed', async (event) => {
			const {team}: any = await webClient.team.info({token: token.bot_access_token});
			if (event.subtype === 'add') {
				additionalEmojis.unshift({
					team: team.id,
					name: event.name,
					url: event.value,
				});
			}
		});
	}

	Promise.all(tokens.map(async (token) => { 
		const {members} = await webClient.users.list({token: token.bot_access_token});
		return members;
	})).then((usersArray) => {
		loadMembersDeferred.resolve(flatten(usersArray));
	});

	Promise.all(tokens.map(async (token) => { 
		const {emoji}: any = await webClient.emoji.list({token: token.access_token});
		const {team}: any = await webClient.team.info({token: token.bot_access_token});
		return Object.entries(emoji).map(([name, url]) => ({
			team: team.id,
			name,
			url,
		}));
	})).then((emojisArray) => {
		loadEmojisDeferred.resolve(flatten(emojisArray));
	});
});

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