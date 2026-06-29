import Slack from '../lib/slackMock';
import mahjong from './index.js';

vi.mock('@octokit/webhooks', () => ({
	Webhooks: vi.fn().mockImplementation(() => ({
		verify: vi.fn().mockResolvedValue(true),
	})),
}));

let slack: InstanceType<typeof Slack> = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	mahjong(slack);
});

describe('mahjong', () => {
	it('responds to "配牌"', async () => {
		const {username} = await slack.getResponseTo('配牌');

		expect(username).toBe('mahjong');
	});
});
