/* eslint-env node, jest */

jest.mock('cloudinary');
jest.mock('sqlite');

const cloudinary = require('cloudinary');
const sqlite = require('sqlite');
const {default: Slack} = require('../lib/slackMock.ts');
const shogi = require('./index.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	shogi(slack);
});

describe('shogi', () => {
	it('responds to "将棋"', async () => {
		cloudinary.url = 'https://hoge.com/hoge.png';
		sqlite.records = [
			{
				board: Buffer.from('000000000000000000000000', 'hex'),
				result: 1,
				depth: 8,
				routes: 90,
				is_good: 1,
			},
		];
		const {username, attachments, text} = await slack.getResponseTo('将棋');

		expect(username).toBe('shogi');
		expect(text).toMatch(/手必勝/);
		expect(attachments).toHaveLength(1);
	});
});
