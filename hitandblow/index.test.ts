import { stripIndent } from 'common-tags';
import hitandblow from './';
import Slack from '../lib/slackMock';

let slack: typeof Slack;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  hitandblow(slack);
});

describe('response to /^hitandblow( \\d+)?$/', () => {
  it('starts game by "hitandblow"', async () => {
    const response = await slack.getResponseTo('hitandblow');
    expect(response.username).toBe('Hit & Blow');
    expect(response.text).toContain('Hit & Blow (4桁) を開始します。');
  });
  it('starts game by "hitandblow 5"', async () => {
    const response = await slack.getResponseTo('hitandblow 5');
    expect(response.username).toBe('Hit & Blow');
    expect(response.text).toContain('Hit & Blow (5桁) を開始します。');
  });
  it('does not start game by "hitandblow 100"', async () => {
    const response = await slack.getResponseTo('hitandblow 100');
    expect(response.username).toBe('Hit & Blow');
    expect(response.text).toContain(
      '桁数は1以上10以下で指定してね:thinking_face:'
    );
  });
});

describe('response to /^hbdiff \\d+ \\d+$/', () => {
  it('replys diff to "hbdiff 0169237 9587234"', async () => {
    const response = await slack.getResponseTo('hbdiff 0169237 9587234');
    expect(response.username).toBe('Hit & Blow');
    expect(response.text).toBe(stripIndent`
    >>>~0~ ~1~ ~6~ _9_ *2* *3* _7_
    _9_ ~5~ ~8~ _7_ *2* *3* ~4~`);
  });
  it('replys error to "hbdiff 0138569237 9501687234"', async () => {
    const response = await slack.getResponseTo('hbdiff 0138569237 9501687234');
    expect(response.username).toBe('Hit & Blow');
    expect(response.text).toBe(
      'どちらかのコール中に同じ数字が含まれているよ:cry:'
    );
  });
  it('replys error to "hbdiff 012 0123"', async () => {
    const response = await slack.getResponseTo('hbdiff 012 0123');
    expect(response.username).toBe('Hit & Blow');
    expect(response.text).toBe('桁数が違うので比較できないよ:cry:');
  });
});
