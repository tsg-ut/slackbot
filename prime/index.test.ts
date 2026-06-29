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
		const {username, text} = await slack.getResponseTo('素数大富豪');

		expect(username).toBe('primebot');
		expect(text).toContain('手札');
	});
});
