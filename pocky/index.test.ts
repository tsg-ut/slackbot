import axios from 'axios';
import pocky from './index.js';
import Slack from '../lib/slackMock';

vi.mock('axios');
vi.mock('../achievements');
vi.mock('../lib/slackUtils');
vi.mock('../lib/state');

let slack: InstanceType<typeof Slack> = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await pocky(slack);
});

describe('pocky', () => {
	it('responds to "ほげ?"', async () => {
		(axios as any).response = {data: [null, ['ほげ ふが']]};
		const {username, text} = await slack.getResponseTo('ほげ?');

		expect(username).toBe('pocky');
		expect(text).toBe('ふが');
	});
});
