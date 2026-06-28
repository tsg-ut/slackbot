type UnblockFn = () => void;

interface BlockEntry {
	name: string;
	promise: Promise<void>;
	time: number;
}

export default class Blocker {
	private readonly blocks: Set<BlockEntry> = new Set();
	private waitPromise: Promise<void> | null = null;

	async block(name: string): Promise<UnblockFn> {
		await this.waitPromise;

		let resolve!: UnblockFn;
		const promise = new Promise<void>((_resolve) => {
			resolve = _resolve;
		});

		const block: BlockEntry = {name, promise, time: Date.now()};
		this.blocks.add(block);

		return () => {
			this.blocks.delete(block);
			resolve();
		};
	}

	async wait(
		callback: () => Promise<void>,
		interval: number,
		intervalCallback?: (blocks: Set<BlockEntry>) => void,
	): Promise<void> {
		let intervalID: ReturnType<typeof setInterval> | null = null;
		if (intervalCallback) {
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

		this.waitPromise = callback();
	}
}
