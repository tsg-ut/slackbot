import {rtmClient, webClient} from './slack';

export class Deferred {
	promise: Promise<any>;
	private nativeReject: (...args: any[]) => any;
	private nativeResolve: (...args: any[]) => any;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.nativeReject = reject;
			this.nativeResolve = resolve;
		});
	}

	resolve(...args: any[]) {
		this.nativeResolve(...args);
	}

	reject(...args: any[]) {
		this.nativeReject(...args);
	}
}

const loadMembersDeferred = new Deferred();
webClient.users.list().then(({members}: any) => {
	loadMembersDeferred.resolve(members);
});
export const getMemberName = async (user: string) => {
	const members = await loadMembersDeferred.promise;
	const member = members.find(({id}: any) => id === user);
	return member.profile.display_name || member.name;
};
export const getMemberIcon = async (user: string) => {
	const members = await loadMembersDeferred.promise;
	const member = members.find(({id}: any) => id === user);
	return member.profile.image_24;
};