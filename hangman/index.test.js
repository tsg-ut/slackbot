jest.mock('../achievements');

const Slack = require('../lib/slackMock.js');
const hangman = require('./index.js');

let slack = null;

beforeEach(() => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    hangman(slack);
});

describe('hangman', () => {
    it('responds to "Hangman"', async () => {
        const {username, attachments, text} = await slack.getResponseTo('Hangman');
        expect(username).toBe('hangmanbot');
        expect(text).toContain('Hangman');
        expect(text).toContain('_');
    });
});