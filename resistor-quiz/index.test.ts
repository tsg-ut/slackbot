import resistorQuiz from './index';
import Slack from '../lib/slackMock';

let slack: Slack;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  resistorQuiz(slack);
});

describe('response to /^抵抗器当てクイズ( (easy|hard))?$/', () => {
  it('starts easy game by "抵抗器当てクイズ"', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ');
    expect('username' in response && response.username).toBe('抵抗器当てクイズ (by Claude Code)');
    expect(response.text).toContain('この抵抗器の抵抗値は何Ωでしょう？ (easyモード)');
  });

  it('starts easy game by "抵抗器当てクイズ easy"', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ easy');
    expect('username' in response && response.username).toBe('抵抗器当てクイズ (by Claude Code)');
    expect(response.text).toContain('この抵抗器の抵抗値は何Ωでしょう？ (easyモード)');
    expect(response.blocks).toBeDefined();
    expect(response.blocks.some((block: any) => block.type === 'image')).toBe(true);
  });

  it('starts hard game by "抵抗器当てクイズ hard"', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ hard');
    expect('username' in response && response.username).toBe('抵抗器当てクイズ (by Claude Code)');
    expect(response.text).toContain('この抵抗器の抵抗値は何Ωでしょう？ (hardモード)');
    expect(response.blocks).toBeDefined();
    expect(response.blocks.some((block: any) => block.type === 'image')).toBe(true);
  });

  it('shows resistor image in easy mode', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ easy');
    expect(response.blocks).toBeDefined();
    const imageBlock = response.blocks.find((block: any) => block.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.alt_text).toBe('抵抗器の色帯');
    expect(response.text).toContain('色の順番: 1桁目 → 2桁目 → 倍率');
  });

  it('shows resistor image in hard mode', async () => {
    const response = await slack.getResponseTo('抵抗器当てクイズ hard');
    expect(response.blocks).toBeDefined();
    const imageBlock = response.blocks.find((block: any) => block.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.alt_text).toBe('抵抗器の色帯');
    expect(response.text).toContain('色の順番: 1桁目 → 2桁目 → 倍率 → 許容差');
  });

  it('provides correct answer format with hints', async () => {
    await slack.getResponseTo('抵抗器当てクイズ');
    
    const hintResponse = await slack.waitForEvent('chat.postMessage') as any;
    expect(hintResponse.text).toContain('抵抗値の計算方法のヒントだよ！');
  });

  it('responds with immediate message when quiz starts', async () => {
    await slack.getResponseTo('抵抗器当てクイズ');
    
    const immediateResponse = await slack.waitForEvent('chat.postMessage') as any;
    expect(immediateResponse.text).toContain('15秒経過でヒントを出すよ♫');
  });
});