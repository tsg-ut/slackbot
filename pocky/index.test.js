/* eslint-env node, jest */

jest.mock('axios');
jest.mock('../achievements');
jest.mock('../lib/slackUtils');
jest.mock('../lib/state.ts');

const axios = require('axios');
const pocky = require('./index.js');
const {default: Slack} = require('../lib/slackMock.ts');

let slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await pocky(slack);
});

describe('pocky', () => {
	it('responds to "ほげ?"', async () => {
		axios.response = {data: [null, ['ほげ ふが']]}
		const {username, text} = await slack.getResponseTo('ほげ?');

		expect(username).toBe('pocky');
		expect(text).toBe('ふが');
	});
});
