jest.mock('../achievements');

import voiperrobot from './index';
import Slack from '../lib/slackMock';

let slack: Slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	voiperrobot(slack);
});

describe('voiperrobot', () => {
	it('responds to ボイパーロボット', async () => {
		const response = await slack.getResponseTo('ボイパーロボット');

		expect('username' in response && response.username).toBe('voiperrobot');
		expect(response.text).toMatch(/(はっ|ひっ|くっ|むか|つく|パン|ツか){8}/);
	});
	it('responds to ボイパーロボットバトル', async () => {
		const response = await slack.getResponseTo('ボイパーロボットバトル');

		expect('username' in response && response.username).toBe('voiperrobot');
		expect(response.text).toContain('ボイパーロボットバトルをはじめるよ〜');
	});
});
