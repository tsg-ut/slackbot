/* eslint-env node, jest */

const cubebot = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	cubebot(slack);
});

it('generates one scramble by "スクランブル"', async () => {
	const {text, username, attachments} = await slack.getResponseTo(
		'スクランブル'
	);

	expect(username).toBe('cubebot');
	expect(text).toBe('');
	expect(attachments).toHaveLength(1);
	expect(attachments[0]).toHaveProperty('title');
	expect(attachments[0]).toHaveProperty('title_link');
	expect(attachments[0]).toHaveProperty('image_url');
});

it('generates five scrambles by "スクランブル5つ"', async () => {
	const {attachments} = await slack.getResponseTo('スクランブル5つ');

	expect(attachments).toHaveLength(5);
});

it('generates twelve scrambles by "スクランブル100つ"', async () => {
	const {attachments} = await slack.getResponseTo('スクランブル100つ');

	expect(attachments).toHaveLength(12);
});
