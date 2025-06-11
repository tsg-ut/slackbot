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
			const response = await slack.getResponseTo('ハイパーロボット');

			const attachments = 'attachments' in response ? response.attachments : [];
			const blocks = 'blocks' in response ? response.blocks : [];

			expect(get_data).toBeCalledTimes(1);
			expect(get_data).toBeCalledWith({depth: 1000, size: {h: 7, w: 9}, numOfWalls: 15});

			expect('username' in response && response.username).toBe('hyperrobot');
			expect(response.text).toContain('10手詰めです');
			expect(attachments).toHaveLength(0);
			expect(blocks).toHaveLength(1);
			expect(blocks[0].type).toBe('section');
			expect((blocks[0] as SectionBlock).accessory?.type).toBe('image');
		}, 60000);
	});
	describe('battle', () => {
		it('responds to ハイパーロボットバトル & responds to first bidding', async () => {
			cloudinaryMock.url = 'https://hoge.com/hoge.png';
			{
				const response = await slack.getResponseTo('ハイパーロボットバトル');
				const attachments = 'attachments' in response ? response.attachments : [];
				expect('username' in response && response.username).toBe('hyperrobot');
				expect(response.text).toContain(':question:手詰めです');
				expect(attachments).toHaveLength(1);
			}
			{
				const response = await slack.getResponseTo('3');
				expect('username' in response && response.username).toBe('hyperrobot');
				expect(response.text).toContain('宣言終了予定時刻:');
			}
		});
	});
});
