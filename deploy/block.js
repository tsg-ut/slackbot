const {Deferred} = require('../lib/utils.ts');

module.exports = class Blocker {
	constructor() {
		this._id = 0;
		this.blocks = {};
		this.waitPromise = null;
	}
	id() {
		return this._id++;
	}
	async block(name) {
		await this.waitPromise;

		const id = this.id();

		const deferred = new Deferred();

		this.blocks[id] = {name, promise: deferred.promise, time: Date.now()};

		return () => {
			delete this.blocks[id];
			deferred.resolve();
		};
	}
	async wait(callback, interval, intervalCallback) {
		let intervalID;
		if (intervalCallback) {
			intervalID = setInterval(() => {intervalCallback(this.blocks)}, interval);
		}
		while (Object.keys(this.blocks).length > 0) {
			await Promise.all(Object.values(this.blocks).map(({promise}) => promise));
		}

		if (intervalID) {
			clearInterval(intervalID);
		}

		this.waitPromise = new Promise(async resolve => {
			await callback();
			resolve();
		});
	}
};
