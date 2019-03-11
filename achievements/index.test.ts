import cubebot from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';

let slack: Slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	cubebot(slack);
});

describe('tiobot', () => {
	it('responds to tio.run URL', async () => {
	});
});
