jest.mock('axios');
jest.mock('../lib/slackUtils');
jest.mock('../lib/download');

import path from 'path';
import fs from 'fs';

jest.mock('fs');

// @ts-expect-error
fs.virtualFiles = {
	[path.join(__dirname, 'data')]: '',
	[path.join(__dirname, 'data','emoji.json')]: `[{"short_names":["hoge","huga"]}]`,
	[path.join(__dirname, 'data','common_word_list')]: `シコウサクゴ,試行錯誤`,
};

import ponpe from './index';
import Slack from '../lib/slackMock';

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
