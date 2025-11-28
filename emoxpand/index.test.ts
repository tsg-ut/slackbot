/* eslint-disable init-declarations, no-restricted-syntax */
/* eslint-env jest */

import Fastify from 'fastify';
import Slack from '../lib/slackMock';
import {server} from './index';

jest.mock('../lib/slackUtils');
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue(JSON.stringify({
      'test-emoji': [['emoji1', 'emoji2'], ['emoji3', 'emoji4']],
      'another-emoji': [['smile']],
    })),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('emoxpand', () => {
  let slack: Slack;

  beforeEach(async () => {
    jest.clearAllMocks();
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;

    const fastify = Fastify();
    await fastify.register(server({
      webClient: slack.webClient,
      eventClient: slack.eventClient,
      messageClient: slack.messageClient,
    }));
  });

  describe('大絵文字一覧', () => {
    it('responds to "大絵文字一覧" with a list of registered big emojis', async () => {
      const result = await slack.getResponseTo('大絵文字一覧');

      expect('username' in result && result.username).toBe('BigEmojier');
      expect(result.icon_emoji).toBe(':chian-ga-aru:');
      expect(result.text).toContain('登録されている大絵文字一覧:');
      expect(result.text).toContain('`!test-emoji!`');
      expect(result.text).toContain('`!another-emoji!`');
    });

    it('responds to "大emoji一覧" with a list of registered big emojis', async () => {
      const result = await slack.getResponseTo('大emoji一覧');

      expect('username' in result && result.username).toBe('BigEmojier');
      expect(result.text).toContain('登録されている大絵文字一覧:');
    });
  });
});
