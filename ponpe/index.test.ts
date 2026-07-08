import path from 'path';
import fs from 'fs';
import ponpe from './index';
import Slack from '../lib/slackMock';

vi.mock('axios');
vi.mock('../lib/slackUtils');
vi.mock('../lib/download');
vi.mock('fs');

// @ts-expect-error
fs.virtualFiles = {
	[path.join(import.meta.dirname, 'data')]: '',
	[path.join(import.meta.dirname, 'data','emoji.json')]: `[{"short_names":["hoge","huga"]}]`,
	[path.join(import.meta.dirname, 'data','common_word_list')]: `シコウサクゴ,試行錯誤`,
};

let slack: Slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await ponpe(slack);
});

describe('ponpe', () => {
	it('responds to ぽんぺ出題', async () => {
		const response = await slack.getResponseTo('ぽんぺ出題');
		expect('username' in response && response.username).toBe('ぽんぺマスター');
		expect(response.text).toMatch(/^ぽんぺをはじめるよ:waiwai:。/);
	});
});
