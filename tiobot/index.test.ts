import Slack from '../lib/slackMock';
import cubebot from './index';

let slack: Slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	cubebot(slack);
});

describe('tiobot', () => {
	it('responds to tio.run URL', async () => {
		const {text, username} = await slack.getResponseTo(
			'https://tio.run/##y0osSyxOLsosKNHNy09J/f8/OT@vOD8nVS8nP11DySM1JydfRyE8vygnRVFJ0/r/fwA',
		);

		expect(username).toBe('tiobot');
		expect(text).toBe('*javascript-node, 29 bytes* \n`console.log("Hello, World!");`');
	});
});
