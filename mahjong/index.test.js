/* eslint-env node, jest */

jest.mock('fs');
jest.mock('axios');
jest.mock('cloudinary');
jest.mock('../achievements');
jest.mock('../deploy/index.ts', () => ({
	blockDeploy: jest.fn(() => jest.fn()),
}));

const {default: Slack} = require('../lib/slackMock.ts');
const mahjong = require('./index.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	process.env.CHANNEL_GAMES = slack.fakeChannel;
	mahjong(slack);
});

describe('mahjong', () => {
	it('responds to "配牌"', async () => {
		const {username} = await slack.getResponseTo('配牌');

		expect(username).toBe('mahjong');
	}, 10000); // Add 10 second timeout
});
