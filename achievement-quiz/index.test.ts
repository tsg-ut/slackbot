import achievementQuiz from './index';
import Slack from '../lib/slackMock';

let slack: Slack;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  achievementQuiz(slack);
});

describe('response to /^実績当てクイズ$/', () => {
  it('starts game by "実績当てクイズ"', async () => {
    const response = await slack.getResponseTo('実績当てクイズ');
    expect(response.username).toBe('実績当てクイズ');
    expect(response.text).toContain('この実績なーんだ');
  });
});
