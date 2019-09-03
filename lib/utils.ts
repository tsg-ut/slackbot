import { stringLiteral } from "@babel/types";

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

export const overflowText = (text: string, length: number) => {
	const chars = Array.from(text);
	if (chars.length <= length) {
		return text;
	}
	return `${chars.slice(0, length - 1).join('')}⋯`;
}