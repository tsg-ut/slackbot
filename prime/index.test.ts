import Slack from '../lib/slackMock';
import prime from './index.js';

vi.mock('../achievements');

let slack: InstanceType<typeof Slack> = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	prime(slack);
});

describe('shogi', () => {
	it('responds to "素数大富豪"', async () => {
		const message = await slack.getResponseTo('素数大富豪');

		expect('username' in message && message.username).toBe('primebot');
		expect(message.text).toContain('手札');
	});
});
