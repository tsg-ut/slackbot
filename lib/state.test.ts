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
import {last} from 'lodash';

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

			await state.set('number', 100);
			expect(state.number).toBe(100);

			expect(last((<jest.Mock>fs.writeFile).mock.calls)).toEqual([
				path.join(__dirname, '__state__', 'test.json'),
				'{\n  "number": 100\n}',
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
