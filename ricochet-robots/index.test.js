'use strict';

jest.mock('cloudinary');
const cloudinary = require('cloudinary');
const hyperrobot = require('./index.js');
const Slack = require('../lib/slackMock.js');

// ./node_modules/jest/bin/jest.js --verbose --coverage ./ricochet-robots/

describe('hyperrobot', () => {
	let slack = null;
	beforeAll(() => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		hyperrobot(slack);	
	});
	describe('base', () => {
		it('responds to ハイパーロボット', async () => {
			cloudinary.url = 'https://hoge.com/hoge.png';
			const {username, attachments, text,} = await slack.getResponseTo('ハイパーロボット 3手');
		
			expect(username).toBe('hyperrobot');
			expect(text).toContain('3手詰めです');
			expect(attachments).toHaveLength(1);
		});
	});
	describe('battle', () => {
		it('responds to ハイパーロボットバトル', async () => {
			cloudinary.url = 'https://hoge.com/hoge.png';
			const {username, attachments, text,} = await slack.getResponseTo('ハイパーロボットバトル');
		
			expect(username).toBe('hyperrobot');
			expect(text).toContain(':question:手詰めです');
			expect(attachments).toHaveLength(1);
		});
		it('responds to first bidding', async () => {
			const {username, text,} = await slack.getResponseTo('3');
			expect(username).toBe('hyperrobot');
			expect(text).toContain('宣言終了予定時刻:');
		});
	});
});
