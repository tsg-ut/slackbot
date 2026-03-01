/* eslint-env node, jest */

jest.mock('../achievements');
jest.mock('../lib/slackUtils');

const {default: Slack} = require('../lib/slackMock.ts');
const prime = require('./index.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	process.env.CHANNEL_GAMES = slack.fakeChannel;
	prime(slack);
});

describe('shogi', () => {
	it('responds to "素数大富豪"', async () => {
		const {username, text} = await slack.getResponseTo('素数大富豪');

		expect(username).toBe('primebot');
		expect(text).toContain('手札');
	});
});
