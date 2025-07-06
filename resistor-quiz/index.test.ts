
import resistorQuiz from './index';
import Slack from '../lib/slackMock';

let slack: Slack;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  resistorQuiz(slack);
});

describe('response to /^抵抗器当てクイズ$/', () => {
  it('starts game by "抵抗器当てクイズ"', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ');
    expect('username' in response && response.username).toBe('抵抗器当てクイズ');
    expect(response.text).toContain('この抵抗器の抵抗値は？');
  });
});
