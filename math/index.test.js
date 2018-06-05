/* eslint-env node, jest */

jest.mock('dockerode');
jest.mock('cloudinary');

const Docker = require('dockerode');
const cloudinary = require('cloudinary');
const math = require('./index.js');
const Slack = require('../lib/slackMock.js');

const PNG = Buffer.from(`
	iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAA
	AABJRU5ErkJggg==
`, 'base64');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	math(slack);
});

describe('math', () => {
	it('responds to "1+1"', async () => {
		Docker.stdout = PNG;
		cloudinary.url = 'https://hoge.com/hoge.png';
		const {text, username, attachments} = await slack.getResponseTo('1+1');

		expect(text).toBe('1+1 =');
		expect(username).toBe('math');
		expect(attachments).toHaveLength(1);
		expect(attachments[0].image_url).toBe('https://hoge.com/hoge.png');
	});
});
