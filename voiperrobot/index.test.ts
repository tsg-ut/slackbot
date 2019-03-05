import voiperrobot from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';

let slack: Slack = null;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  voiperrobot(slack);
});

describe('voiperrobot', () => {
  it('reponds to ボイパーロボット', async () => {
		const {text, username} = await slack.getResponseTo('ボイパーロボット');

		expect(username).toBe('voiperrobot');
		expect(text).toMatch(/(はっ|ひっ|くっ|むか|つく|パン|ツか){8}/);
  });
  it('reponds to ボイパーロボットバトル', async () => {
		const {text, username} = await slack.getResponseTo('ボイパーロボットバトル');

		expect(username).toBe('voiperrobot');
		expect(text).toContain('ボイパーロボットバトルをはじめるよ〜');
  });
});
