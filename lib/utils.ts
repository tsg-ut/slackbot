export class Deferred<T> {
	promise: Promise<T>;
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
