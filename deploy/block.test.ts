/* eslint-disable require-await */

import {expect, it, beforeEach} from 'vitest';
import Blocker from './block.js';

let blocker: InstanceType<typeof Blocker> = null;

beforeEach(() => {
	blocker = new Blocker();
});

it('blocks until unblocked', () => new Promise<void>(async (resolve) => {
	const unblock = await blocker.block('block1');
	let blocked = true;

	blocker.wait(async () => {
		expect(blocked).toBe(false);
		resolve();
	}, 0);

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

	blocker.wait(async () => {
		expect(unblocked).toBe(10);
		resolve();
	}, 0);

	while (unblocks.length > 0) {
		unblocked++;
		unblocks.shift()();

		await new Promise((resolve) => process.nextTick(resolve));
	}
}));

it('calls intervalCallback when block continues', () => new Promise<void>(async (resolve, reject) => {
	await blocker.block('block');

	blocker.wait(async () => {
		reject(new Error());
	}, 0, () => resolve());
}));

it('does not call intervalCallback unless blocked', () => new Promise<void>(async (resolve, reject) => {
	const unblock = await blocker.block('block');
	unblock();

	blocker.wait(async () => {
		process.nextTick(resolve);
	}, 0, reject);
}));

it('cannot block while wait callback is runnning', () => new Promise<void>(async (resolve, reject) => {
	blocker.wait(() => new Promise<void>((callbackResolve) => process.nextTick(() => {
		resolve();
		callbackResolve();
	})), 0);

	await blocker.block('block');
	reject(new Error());
}));
