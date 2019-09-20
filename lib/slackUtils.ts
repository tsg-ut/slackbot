import {WebClient} from '@slack/client';
import {flatten} from 'lodash';
import {getTokens, getRtmClient} from './slack';
import {Deferred} from './utils';

const webClient = new WebClient();

const additionalMembers: any[] = [];

const loadMembersDeferred = new Deferred();
getTokens().then(async (tokens) => {
	for (const token of tokens) {
		const rtmClient = await getRtmClient(token);
		rtmClient.on('team_join', (event) => {
			additionalMembers.unshift(event.user);
		});
		rtmClient.on('user_change', (event) => {
			additionalMembers.unshift(event.user);
		});
	}

	const usersArray = await Promise.all(tokens.map(async (token) => { 
		const {members} = await webClient.users.list({token});
		return members;
	}));

	loadMembersDeferred.resolve(flatten(usersArray));
});

export const getMemberName = async (user: string): Promise<string> => {
	const members = [
		...additionalMembers,
		...(await loadMembersDeferred.promise),
	];
	const member = members.find(({id}: any) => id === user);
	return member.profile.display_name || member.name;
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