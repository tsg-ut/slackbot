jest.mock('cloudinary');

import octas from './index';
import Slack from '../lib/slackMock';

let slack: Slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await octas(slack);
});

describe('octas', () => {
    it('respond to octas', async () => {
        const response = await slack.getResponseTo('octas');
        const { channel, text } = response;
        const attachments = 'attachments' in response ? response.attachments : [];

        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Octas対人を始めるよ～');
        expect(attachments).toHaveLength(1);
    });
});
