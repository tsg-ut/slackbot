import Blocker from './block';

let blocker: InstanceType<typeof Blocker> = null;

beforeEach(() => {
	blocker = new Blocker();
});

it('blocks until unblocked', () => new Promise<void>(async (resolve) => {
	const unblock = await blocker.block('block1');
	let blocked = true;

	blocker.wait(() => {
		expect(blocked).toBe(false);
		resolve();
	});

	process.nextTick(() => {
		blocked = false;
		unblock();
	});
}));

it('blocks until all unblocked', () => new Promise<void>(async (resolve) => {
	const unblocks: (() => void)[] = [];
	for (let i = 0; i < 10; i++) {
		unblocks.push(await blocker.block(`block${i}`));
	}
	let unblocked = 0;

	blocker.wait(() => {
		expect(unblocked).toBe(10);
		resolve();
	});

	while (unblocks.length > 0) {
		unblocked++;
		unblocks.shift()();

		await new Promise((res) => process.nextTick(res));
	}
}));

it('calls intervalCallback when block continues', () => new Promise<void>(async (resolve, reject) => {
	await blocker.block('block');

	blocker.wait(reject as () => void, 0, resolve);
}));

it('does not call intervalCallback unless blocked', () => new Promise<void>(async (resolve, reject) => {
	const unblock = await blocker.block('block');
	unblock();

	blocker.wait(() => {
		process.nextTick(resolve);
	}, 0, reject as () => void);
}));

it('cannot block while wait callback is runnning', () => new Promise<void>(async (resolve, reject) => {
	blocker.wait(() => new Promise<void>((callbackResolve) => process.nextTick(() => {
		resolve();
		callbackResolve();
	})));

	await blocker.block('block');
	reject(new Error());
}));
