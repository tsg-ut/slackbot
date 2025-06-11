/* eslint-env node, jest */

jest.mock('download');
jest.mock('../lib/getReading.js');
jest.mock('../achievements');

const download = require('download');

download.response = Array(10).fill('単語\tたんご\t単語\t000').join('\n');

const {default: Slack} = require('../lib/slackMock.ts');
const tahoiya = require('./index.js');

let slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await tahoiya(slack);
});

describe('tahoiya', () => {
	it('responds to "たほいや"', async () => {
		const {username, text, attachments} = await slack.getResponseTo('たほいや');

		expect(username).toBe('tahoiya');
		expect(text).toContain('たほいや');
		expect(attachments).toHaveLength(10);
	});
});
