'use strict';

jest.mock('cloudinary');
jest.mock('./rust-proxy.js');
jest.mock('../achievements');

const cloudinary = require('cloudinary');
const rust_proxy = require('./rust-proxy.js');

const hyperrobot = require('./index.js');
const Slack = require('../lib/slackMock.js');

const fs = require('fs');
const path = require('path');
rust_proxy.get_data.mockImplementation((x) => {
	return new Promise((resolve) => {
		resolve(fs.readFileSync(path.join(__dirname,'rust_test_output.txt')).toString());
	});
});



// ./node_modules/jest/bin/jest.js --verbose --coverage ./ricochet-robots/

describe('hyperrobot', () => {
	let slack = null;
	beforeAll(() => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		hyperrobot(slack);
		jest.useFakeTimers();
	});
	afterAll(() => {
		jest.useRealTimers();
	});
	describe('base', () => {
		it('responds to ハイパーロボット', async () => {
			cloudinary.url = 'https://hoge.com/hoge.png';
			const {username, attachments, text,} = await slack.getResponseTo('ハイパーロボット');

			expect(username).toBe('hyperrobot');
			expect(text).toContain('10手詰めです');
			expect(attachments).toHaveLength(1);
		}, 60000);
	});
	describe('battle', () => {
		it('responds to ハイパーロボットバトル', async () => {
			cloudinary.url = 'https://hoge.com/hoge.png';
			const {username, attachments, text,} = await slack.getResponseTo('ハイパーロボットバトル');
			expect(username).toBe('hyperrobot');
			expect(text).toContain(':question:手詰めです');
			expect(attachments).toHaveLength(1);
		}, 60000);
		it('responds to first bidding', async () => {
			const {username, text,} = await slack.getResponseTo('3');
			expect(username).toBe('hyperrobot');
			expect(text).toContain('宣言終了予定時刻:');
		});
	});
});
