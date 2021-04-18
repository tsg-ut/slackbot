jest.mock('../achievements');

jest.mock('./state.json', () => ({
    phase: 'waiting',
    challenger: null,
    thread: null,
    diffValue: '',
    answer: '',
    openList: [],
    usedCharacterList: [],
    triesLeft: 0,
}));

const Slack = require('../lib/slackMock.js');
const hangman = require('./index.js');

jest.mock('fs');

let slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await hangman(slack);
});

describe('hangman', () => {
    it('responds to "Hangman"', async () => {
        const {username, text} = await slack.getResponseTo('Hangman');
        expect(username).toBe('hangmanbot');
        expect(text).toContain('Hangman');
        expect(text).toContain('_');
    });
});