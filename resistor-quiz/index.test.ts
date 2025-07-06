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
    expect('username' in response && response.username).toBe('抵抗器当てクイズ (by Claude Code)');
    expect(response.text).toContain('この抵抗器の抵抗値は何Ωでしょう？');
  });

  it('shows color code with emojis', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ');
    expect(response.text).toMatch(/[⚫🟤🔴🟠🟡🟢🔵🟣⚪🟨🤍]{3}/);
  });

  it('provides correct answer format', async () => {
    await slack.getResponseTo('抵抗器当てクイズ');
    
    const hintResponse = await slack.waitForEvent('chat.postMessage') as any;
    expect(hintResponse.text).toContain('抵抗値の計算方法のヒントだよ！');
  });

  it('responds with message when quiz starts', async () => {
    await slack.getResponseTo('抵抗器当てクイズ');
    
    const immediateResponse = await slack.waitForEvent('chat.postMessage') as any;
    expect(immediateResponse.text).toContain('15秒経過でヒントを出すよ♫');
  });
});