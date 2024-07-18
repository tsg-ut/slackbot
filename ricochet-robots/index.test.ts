'use strict';

jest.mock('cloudinary');
jest.mock('./rust-proxy');
jest.mock('../achievements');
jest.mock('../lib/slackUtils');

import cloudinary from 'cloudinary';
import * as rust_proxy from './rust-proxy';

import hyperrobot from './index';
import Slack from '../lib/slackMock';

import fs from 'fs';
import path from 'path';
import type { SectionBlock } from '@slack/web-api';

const get_data = rust_proxy.get_data as jest.MockedFunction<typeof rust_proxy.get_data>;
get_data.mockImplementation((x) => {
	return new Promise((resolve) => {
		resolve(fs.readFileSync(path.join(__dirname,'rust_test_output.txt')).toString());
	});
});

const cloudinaryMock = cloudinary as (typeof cloudinary & {url: string});


// ./node_modules/jest/bin/jest.js --verbose --coverage ./ricochet-robots/

describe('hyperrobot', () => {
	let slack: Slack | null = null;
	beforeEach(() => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		hyperrobot(slack);
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});
	describe('base', () => {
		it('responds to ハイパーロボット', async () => {
			cloudinaryMock.url = 'https://hoge.com/hoge.png';
			const {username, attachments, blocks, text,} = await slack.getResponseTo('ハイパーロボット');

			expect(username).toBe('hyperrobot');
			expect(text).toContain('10手詰めです');
			expect(attachments).toBe(undefined);
			expect(blocks).toHaveLength(1);
			expect(blocks[0].type).toBe('section');
			expect((blocks[0] as SectionBlock).accessory?.type).toBe('image');
		}, 60000);
	});
	describe('battle', () => {
		it('responds to ハイパーロボットバトル & responds to first bidding', async () => {
			cloudinaryMock.url = 'https://hoge.com/hoge.png';
			{
				const {username, attachments, text,} = await slack.getResponseTo('ハイパーロボットバトル');
				expect(username).toBe('hyperrobot');
				expect(text).toContain(':question:手詰めです');
				expect(attachments).toHaveLength(1);
			}
			{
				const {username, text,} = await slack.getResponseTo('3');
				expect(username).toBe('hyperrobot');
				expect(text).toContain('宣言終了予定時刻:');
			}
		});
	});
});
