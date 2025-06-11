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
		const response = await slack.getResponseTo(
			'https://tio.run/##y0osSyxOLsosKNHNy09J/f8/OT@vOD8nVS8nP11DySM1JydfRyE8vygnRVFJ0/r/fwA',
		);

		// eslint-disable-next-line no-restricted-syntax
		expect('username' in response && response.username).toBe('tiobot');
		expect(response.text).toBe('*javascript-node, 29 bytes* \n`console.log("Hello, World!");`');
	});
});
