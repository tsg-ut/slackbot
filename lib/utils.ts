import {rtmClient, webClient} from './slack';

export class Deferred {
	promise: Promise<any>;
	isResolved: boolean;
	isRejected: boolean;
	private nativeReject: (...args: any[]) => any;
	private nativeResolve: (...args: any[]) => any;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.nativeReject = reject;
			this.nativeResolve = resolve;
		});
		this.isResolved = false;
		this.isRejected = false;
	}

	resolve(...args: any[]) {
		this.nativeResolve(...args);
		this.isResolved = true;
		return this.promise;
	}

	reject(...args: any[]) {
		this.nativeReject(...args);
		this.isRejected = true;
		return this.promise;
	}
}

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