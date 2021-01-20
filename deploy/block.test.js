/* eslint-env node, jest */

const Blocker = require('./block.js');

let blocker = null;

beforeEach(() => {
	blocker = new Blocker();
});

it('blocks until unblocked', () => new Promise(async (resolve) => {
	const unblock = await blocker.block('block1');
	let blocked = true;

	blocker.wait(async () => {
		expect(blocked).toBe(false);
		resolve();
	});

	process.nextTick(() => {
		blocked = false;
		unblock();
	});
}));

it('blocks until all unblocked', () => new Promise(async (resolve) => {
	const unblocks = [];
	for (let i = 0; i < 10; i++) {
		unblocks.push(await blocker.block(`block${i}`));
	}
	let unblocked = 0;

	blocker.wait(async () => {
		expect(unblocked).toBe(10);
		resolve();
	});

	while (unblocks.length > 0) {
		unblocked++;
		unblocks.shift()();

		await new Promise((resolve) => process.nextTick(resolve));
	}
}));

it('calls intervalCallback when block continues', () => new Promise(async (resolve, reject) => {
	const unblock = await blocker.block('block');

	blocker.wait(reject, 0, resolve);
}));

it('does not call intervalCallback unless blocked', () => new Promise(async (resolve, reject) => {
	const unblock = await blocker.block('block');
	unblock();

	blocker.wait(async () => {
		process.nextTick(resolve);
	}, 0, reject);
}));

it('cannot block while wait callback is runnning', () => new Promise(async (resolve, reject) => {
	blocker.wait(() => new Promise((callbackResolve) => process.nextTick(() => {
		resolve();
		callbackResolve();
	})));

	await blocker.block('block');
	reject();
}));
