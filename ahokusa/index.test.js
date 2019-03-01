/* eslint-env node, jest */

const ahokusa = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	ahokusa(slack);
});

describe('ahokusa', () => {
	it('responds to あほくさスライドパズル', async () => {
		const {text, username} = await slack.getResponseTo('あほくさスライドパズル');

		expect(username).toBe('ahokusa');
		expect(text).toContain(':void:');
		expect(text).toMatch(/^(:[a-z-]+:\n?){6}$/);
	});
});
