module.exports = class Blocker {
	constructor() {
		this._id = 0;
		this.blocks = new Set();
		this.waitPromise = null;
	}
	async block(name) {
		await this.waitPromise;

		let resolve;
		const promise = new Promise(_resolve => resolve = _resolve);

		const block = {name, promise, time: Date.now()};
		this.blocks.add(block);

		return () => {
			this.blocks.delete(block);
			resolve();
		};
	}
	async wait(callback, interval, intervalCallback) {
		let intervalID;
		if (intervalCallback) {
			intervalID = setInterval(() => {intervalCallback(this.blocks)}, interval);
		}
		while (this.blocks.size > 0) {
			await Promise.all([...this.blocks].map(({promise}) => promise));
		}

		if (intervalID) {
			clearInterval(intervalID);
		}

		this.waitPromise = callback();
	}
};
