const Slack = require('../lib/slackMock.js');
const hitandblow = require('./');

let slack: typeof Slack;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  hitandblow(slack.rtmClient, slack.webClient);
});

describe('responding /^hitandblow( d+)?$/', () => {
  it('responds to "hitandblow"', async () => {
    const responce = await slack.getResponseTo('hitandblow');
    expect(responce.username).toBe('Hit & Blow');
    expect(responce.text).toContain('Hit & Blow (4桁) を開始します。');
  });
  it('responds to "hitandblow 5"', async () => {
    const responce = await slack.getResponseTo('hitandblow 5');
    expect(responce.username).toBe('Hit & Blow');
    expect(responce.text).toContain('Hit & Blow (5桁) を開始します。');
  });
  it('does not start game by "hitandblow 100"', async () => {
    const responce = await slack.getResponseTo('hitandblow 100');
    expect(responce.username).toBe('Hit & Blow');
    expect(responce.text).toContain(
      '桁数は1以上10以下で指定してね:thinking_face:'
    );
  });
});
