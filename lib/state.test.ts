jest.mock('fs-extra', () => ({
	mkdirp: jest.fn(),
	readFile: jest.fn(() => Promise.resolve(Buffer.from(''))),
	writeFile: jest.fn(),
	pathExists: jest.fn(() => Promise.resolve(false)),
}));

process.env.NODE_ENV = 'development';

import {StateDevelopment} from './state';
import path from 'path';
import fs from 'fs-extra';

interface StateObj {
	number: number,
	number2?: number,
	list?: Array<{a: number, b: string}>,
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe('State', () => {
	describe('StateDevelopment', () => {
		it('writes default values as JSON when initialization', async () => {
			await StateDevelopment.init<StateObj>('test', {number: 334});
			expect((<jest.Mock>fs.mkdirp).mock.calls).toHaveLength(1);
			expect((<jest.Mock>fs.writeFile).mock.calls).toHaveLength(1);
			expect((<jest.Mock>fs.writeFile).mock.calls[0]).toEqual([
				path.join(__dirname, '__state__', 'test.json'),
				'{\n  "number": 334\n}',
			]);
		});

		it('makes state data saved to local state', async () => {
			const state = await StateDevelopment.init<StateObj>('test', {
				number: 334,
				list: [{a: 0, b: '0'}],
			});

			expect(state.number).toBe(334);

			state.number = 100;

			expect(state.number).toBe(100);

			state.list = state.list.concat([{a: 1, b: '1'}]);

			expect(state.list).toStrictEqual([{a: 0, b: '0'}, {a: 1, b: '1'}]);
		});

		it('saves JSON with updated data', async () => {
			const state = await StateDevelopment.init<StateObj>('test', {
				number: 334,
			});

			const call = await new Promise((resolve) => {
				(<jest.Mock>fs.writeFile).mockImplementationOnce((...args) => resolve(args));

				state.number = 100;
				expect(state.number).toBe(100);
			});

			expect(call).toEqual([
				path.join(__dirname, '__state__', 'test.json'),
				'{\n  "number": 100\n}',
			]);
		});

		it('detects updates on nested property', async () => {
			const state = await StateDevelopment.init<StateObj>('test', {
				number: 100,
				list: [{a: 0, b: '0'}, {a: 1, b: '1'}],
			});

			const call = await new Promise((resolve) => {
				(<jest.Mock>fs.writeFile).mockImplementationOnce((...args) => resolve(args));

				const item = state.list.find(({a}) => a === 1);
				item.b = '2';

				expect(state.list).toEqual([{a: 0, b: '0'}, {a: 1, b: '2'}]);
			});

			expect(call).toEqual([
				path.join(__dirname, '__state__', 'test.json'),
				JSON.stringify({number: 100, list: [{a: 0, b: '0'}, {a: 1, b: '2'}]}, null, '  '),
			]);
		});

		it('detects updates on new property', async () => {
			const state = await StateDevelopment.init<StateObj>('test', {
				number: 100,
			});

			const call = await new Promise((resolve) => {
				(<jest.Mock>fs.writeFile).mockImplementationOnce((...args) => resolve(args));

				state.number2 = 200;
				expect(state.number2).toBe(200);
			});

			expect(call).toEqual([
				path.join(__dirname, '__state__', 'test.json'),
				'{\n  "number": 100,\n  "number2": 200\n}',
			]);
		});

		it('detects call to the mutable methods of array', async () => {
			const state = await StateDevelopment.init<StateObj>('test', {
				number: 100,
				list: [],
			});

			const call = await new Promise((resolve) => {
				(<jest.Mock>fs.writeFile).mockImplementationOnce((...args) => resolve(args));

				state.list.push({a: 100, b: '100'})
				expect(state.list).toEqual([{a: 100, b: '100'}]);
			});

			expect(call).toEqual([
				path.join(__dirname, '__state__', 'test.json'),
				JSON.stringify({number: 100, list: [{a: 100, b: '100'}]}, null, '  '),
			]);
		});

		it('merges the saved state with the default value', async () => {
			(<jest.Mock>fs.pathExists).mockImplementation(async () => true);
			(<jest.Mock>fs.readFile).mockImplementation(async () => (
				JSON.stringify({number: 100, list: [{a: 1, b: '1'}]})
			));

			const state = await StateDevelopment.init<StateObj>('test', {
				number: 200,
				number2: 300,
				list: [{a: 0, b: '0'}],
			});

			expect(state.number).toBe(100);
			expect(state.number2).toBe(300);
			expect(state.list).toEqual([{a: 1, b: '1'}]);
		});
	});
});
