/* eslint-env node, jest */

jest.mock('../achievements');

const mahjong = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	mahjong(slack);
});

describe('mahjong', () => {
	it('responds to "配牌"', async () => {
		const {username} = await slack.getResponseTo('配牌');

		expect(username).toBe('mahjong');
	});
});
