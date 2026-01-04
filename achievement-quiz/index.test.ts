import { AchievementQuizBot } from './index';
import Slack from '../lib/slackMock';

jest.mock('../lib/slackUtils', () => ({
  extractMessage: (message: any) => message,
  isGenericMessage: (message: any) => message.subtype === undefined,
}));

let slack: Slack;
let bot: AchievementQuizBot;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  process.env.CHANNEL_GAMES = slack.fakeChannel;
  bot = new AchievementQuizBot(slack);
  jest.spyOn(slack.webClient.chat, 'getPermalink').mockResolvedValue({
    ok: true,
    permalink: 'https://example.com',
  });
});

describe('response to /^実績当てクイズ$/', () => {
  it('starts game by "実績当てクイズ"', async () => {
    await slack.postMessage('実績当てクイズ');
    await new Promise(setImmediate);
    // @ts-ignore
    const calls = slack.webClient.chat.postMessage.mock.calls;
    const firstCallArgs = calls[0][0];
    expect(firstCallArgs.username).toBe('実績当てクイズ');
    expect(firstCallArgs.text).toContain('この実績なーんだ');
  });
});
