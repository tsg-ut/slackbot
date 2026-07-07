import sqlite from 'sqlite';
import {expect, it, beforeEach, describe, vi} from 'vitest';
import Slack from '../lib/slackMock';
import shogi from './index.js';

vi.mock('./image.js', () => ({
	upload: vi.fn(() => Promise.resolve('https://hoge.com/hoge.png')),
}));
vi.mock('sqlite');
vi.mock('sqlite3', () => {
	const Database = vi.fn();
	return {default: {Database}, Database};
});

let slack: InstanceType<typeof Slack> = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	shogi(slack);
});

describe('shogi', () => {
	it('responds to "将棋"', async () => {
		(sqlite as any).records = [
			{
				board: Buffer.from('000000000000000000000000', 'hex'),
				result: 1,
				depth: 8,
				routes: 90,
				is_good: 1,
			},
		];
		const message = await slack.getResponseTo('将棋');

		expect('username' in message && message.username).toBe('shogi');
		expect(message.text).toMatch(/手必勝/);
		expect('attachments' in message && message.attachments).toHaveLength(1);
	});
});
