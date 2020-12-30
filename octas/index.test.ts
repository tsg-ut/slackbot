jest.mock('cloudinary');

import octas from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import { List } from 'lodash';

let slack: Slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await octas(slack);
});

describe('octas', () => {
    it('respond to octas', async () => {
        const { channel, text, attachments }: { channel: string, text: string, attachments: List<any> } = await slack.getResponseTo('octas');

        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Octas対人を始めるよ～');
        expect(attachments).toHaveLength(1);
    });
});
