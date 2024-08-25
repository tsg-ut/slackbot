import {Deferred} from '../lib/utils';

type Block = {
	name: string;
	promise: Promise<void>;
	time: number;
};

export default class Blocker {
	private blocks = new Set<Block>();

	private waitDeferred = new Deferred<void>();

	async block(name: string): Promise<() => void> {
		await this.waitDeferred.promise;

		const deferred = new Deferred<void>();

		const block: Block = {name, promise: deferred.promise, time: Date.now()};
		this.blocks.add(block);

		return () => {
			this.blocks.delete(block);
			deferred.resolve();
		};
	}

	async wait(callback: () => Promise<void>, interval?: number, intervalCallback?: (blocks: Set<Block>) => void): Promise<void> {
		let intervalID: NodeJS.Timeout | null = null;
		if (intervalCallback && interval) {
			intervalID = setInterval(() => {
				intervalCallback(this.blocks);
			}, interval);
		}

		while (this.blocks.size > 0) {
			await Promise.all([...this.blocks].map(({promise}) => promise));
		}

		if (intervalID) {
			clearInterval(intervalID);
		}

		callback().then(() => {
			this.waitDeferred.resolve();
		});
	}
}
