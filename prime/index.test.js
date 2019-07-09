/* eslint-env node, jest */

const shogi = require('./index.js');
const Slack = require('../lib/slackMock.js');

jest.mock('../achievements/index.ts');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	shogi(slack);
});

describe('shogi', () => {
	it('responds to "素数大富豪"', async () => {
		const {username, text} = await slack.getResponseTo('素数大富豪');

		expect(username).toBe('primebot');
		expect(text).toContain('手札');
	});
});
