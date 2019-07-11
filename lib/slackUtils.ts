import {rtmClient, webClient} from './slack';
import {Deferred} from './utils';

const loadMembersDeferred = new Deferred();
webClient.users.list().then(({members}: any) => {
	loadMembersDeferred.resolve(members);
});
const additionalMembers: any[] = [];
rtmClient.on('team_join', (event) => {
	additionalMembers.push(event.user);
});
export const getMemberName = async (user: string): Promise<string> => {
	const members = [
		...(await loadMembersDeferred.promise),
		...additionalMembers,
	];
	const member = members.find(({id}: any) => id === user);
	return member.profile.display_name || member.name;
};
export const getMemberIcon = async (user: string): Promise<string> => {
	const members = [
		...(await loadMembersDeferred.promise),
		...additionalMembers,
	];
	const member = members.find(({id}: any) => id === user);
	return member.profile.image_24;
};