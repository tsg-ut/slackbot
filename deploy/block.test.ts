/* eslint-env node, jest */

import Blocker from './block';

describe('Blocker', () => {
	let blocker: Blocker | null = null;

	beforeEach(() => {
		blocker = new Blocker();
	});

	it('blocks until unblocked', () => new Promise(async (resolve) => {
		const unblock = await blocker.block('block1');
		let blocked = true;

		blocker.wait(() => {
			expect(blocked).toBe(false);
			resolve(null);
			return Promise.resolve();
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

		blocker.wait(() => {
			expect(unblocked).toBe(10);
			resolve(null);
			return Promise.resolve();
		});

		while (unblocks.length > 0) {
			unblocked++;
			unblocks.shift()();

			await new Promise((resolve) => process.nextTick(resolve));
		}
	}));

	it('calls intervalCallback when block continues', () => new Promise(async (resolve, reject) => {
		await blocker.block('block');

		blocker.wait(() => {
			reject(new Error());
			return Promise.resolve();
		}, 0, resolve);
	}));

	it('does not call intervalCallback unless blocked', () => new Promise(async (resolve, reject) => {
		const unblock = await blocker.block('block');
		unblock();

		blocker.wait(() => {
			process.nextTick(resolve);
			return Promise.resolve();
		}, 0, reject);
	}));

	it('cannot block while wait callback is runnning', () => new Promise(async (resolve, reject) => {
		blocker.wait(() => new Promise((callbackResolve) => process.nextTick(() => {
			resolve(null);
			callbackResolve();
		})));

		await blocker.block('block');
		reject(new Error());
	}));
});
