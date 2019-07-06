jest.mock('download');

// @ts-ignore
import Slack from '../lib/slackMock.js';
import download from 'download';

// @ts-ignore
download.response = `
0028; 0029; o # LEFT PARENTHESIS
0029; 0028; c # RIGHT PARENTHESIS
005B; 005D; o # LEFT SQUARE BRACKET
005D; 005B; c # RIGHT SQUARE BRACKET
007B; 007D; o # LEFT CURLY BRACKET
007D; 007B; c # RIGHT CURLY BRACKET`.trimLeft();

import bracketMatcher from './index';

let slack: Slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	bracketMatcher(slack);
});

describe('bracket-matcher', () => {
	it('responds to unmatched open parentheses', async () => {
		const {text, username} = await slack.getResponseTo('aa[b[c]d{ee(ff');

		expect(username).toBe('bracket-matcher');
		expect(text).toBe(')}]');
	});
});
