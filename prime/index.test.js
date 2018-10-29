/* eslint-env node, jest */

const shogi = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	shogi(slack);
});

describe('shogi', () => {
	it('responds to "素数大富豪"', async () => {
		const {username, attachments} = await slack.getResponseTo('素数大富豪');

		expect(username).toBe('prime');
		expect(attachments).toHaveLength(1);
	});
});
