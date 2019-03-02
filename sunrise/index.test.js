/* eslint-env node, jest */

jest.mock('cloudinary');
jest.mock('axios');
jest.mock('node-persist');
jest.mock('./render.js');
jest.mock('./fetch.js');

const sunrise = require('./index.js');
const Slack = require('../lib/slackMock.js');
const lolex = require('lolex');

let slack = null;
let clock = null;

describe('sunrise', () => {
	beforeEach(async () => {
		slack = new Slack();
		clock = lolex.install();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await sunrise(slack);
	});

	afterEach(() => {
		if (clock !== null) {
			clock.uninstall();
		}
	});

	it('notify sunrise on sunrise', () => new Promise((resolve) => {
		clock.setSystemTime(new Date('2019-03-21T06:00:00+0900'));

		slack.on('chat.postMessage', ({text}) => {
			if (!text.includes('wave')) {
				expect(text).toContain('ahokusa');
				resolve();
			}
		});
		clock.tick(15 * 1000);
	}));

	it('notify sunset on sunset', () => new Promise((resolve) => {
		clock.setSystemTime(new Date('2019-03-21T19:00:00+0900'));

		slack.on('chat.postMessage', ({text}) => {
			if (!text.includes('ahokusa')) {
				expect(text).toContain('wave');
				resolve();
			}
		});
		clock.tick(15 * 1000);
	}));
});
