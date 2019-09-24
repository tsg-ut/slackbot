jest.mock('axios');
jest.mock('../lib/slackUtils');

import ponpe from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import axios from 'axios';

let slack: Slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await ponpe(slack);
});

describe('ponpe', () => {
	it('responds to ぽんぺ出題', async () => {
		const {text, username} = await slack.getResponseTo('ぽんぺ出題');
		expect(username).toBe('ぽんぺマスター');
		expect(text).toMatch(/^ぽんぺをはじめるよ:waiwai:。/);
	});
});

