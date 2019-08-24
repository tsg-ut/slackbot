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
type IconResoluton = 24 | 32 | 48 | 72 | 192 | 512;
export const getMemberIcon = async (user: string, res: IconResoluton = 24): Promise<string> => {
	const members = [
		...(await loadMembersDeferred.promise),
		...additionalMembers,
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
