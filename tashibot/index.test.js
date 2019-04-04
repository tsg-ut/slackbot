/* eslint-env node, jest */

jest.mock('cloudinary');
jest.mock('download');
jest.mock('../lib/getReading.js');
jest.mock('../achievements/index.ts');

const tashibot = require('./index.js');
const Slack = require('../lib/slackMock.js');
const getReading = require('../lib/getReading.js');

const download = require('download');

download.response = Buffer.alloc(0x100);

getReading.virtualReadings = {
	飽きたし: 'アキタシ',
};

let slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await tashibot(slack);
});

describe('tashibot', () => {
	it('responds to "飽きたし"', async () => {
		const {text, username} = await slack.getResponseTo('飽きたし');

		expect(username).toBe('tashibot');
		expect(text).toBe('秋田県秋田市');
	});
});
