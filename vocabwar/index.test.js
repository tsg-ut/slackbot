/* eslint-env node, jest */

const vocabwar = require('./index.js');
const Slack = require('../lib/slackMock.js');
const {promisify} = require('util');
const path = require('path');
const fs = require('fs');

let slack = null;

const deleteState = async () => {
	if (await new Promise((resolve) => {
		fs.access(path.join(__dirname, 'state.json'), fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	})) {
		await promisify(fs.unlink)(path.join(__dirname, 'state.json'));
	}
};

describe('vocabwar', () => {
	beforeEach(async () => {
		jest.setTimeout(1000 * 60 * 10);
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await deleteState();
		await vocabwar(slack);
	});

	afterEach(async () => {
		await deleteState();
	});

	it('responds to "弓箭"', async () => {
		const {username, text, attachments} = await slack.getResponseTo('弓箭');

		expect(username).toBe('vocabwar');
		expect(text).toContain('弓箭');
		expect(attachments).toHaveLength(10);
	});

	it('responds to "即弓箭"', async () => {
		const {username, text} = await slack.getResponseTo('即弓箭');

		expect(username).toBe('vocabwar');
		expect(text).toContain('弓箭');
		expect(text).toContain('終了予定時刻');
	});

	it('responds to "弓箭 お題"', async () => {
		const {username, text} = await slack.getResponseTo('弓箭 丸い');

		expect(username).toBe('vocabwar');
		expect(text).toContain('弓箭');
		expect(text).toContain('終了予定時刻');
		expect(text).toContain('丸い');
	});

	it('does not set unknown words to theme by "弓箭 お題"', async () => {
		const {username, text} = await slack.getResponseTo('弓箭 んをわろれるりら');
		expect(username).toBe('vocabwar');
		expect(text).toContain('知らない');
		expect(text).not.toContain('決定');
	});
});

describe('vocabwar', () => {
	beforeAll(async () => {
		jest.setTimeout(1000 * 60 * 10);
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await deleteState();
		await vocabwar(slack);
		await slack.getResponseTo('弓箭 丸い');
	});

	afterAll(async () => {
		await deleteState();
	});

	it('rejects the same word as theme', async () => {
		const {username, text} = await slack.getResponseTo('丸い');
		expect(username).toBe('vocabwar');
		expect(text).toContain('お題');
	});

	it('rejects unknown word', async () => {
		const {username, text} = await slack.getResponseTo('んをわろれるりら');
		expect(username).toBe('vocabwar');
		expect(text).toContain('知らない');
	});

	it('reacts "+1" to valid answer', () => new Promise((resolve, reject) => {
		slack.on('reactions.add', ({name}) => {
			expect(name).toBe('+1');
			resolve();
		});

		slack.rtmClient.emit('message', {
			channel: slack.fakeChannel,
			text: '鋭い',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	}));
});
