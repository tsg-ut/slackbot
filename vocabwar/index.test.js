/* eslint-env node, jest */

jest.mock('axios');
jest.mock('fs');
jest.mock('word2vec');

jest.mock('./state.json', () => ({}), {virtual: true});

const vocabwar = require('./index.js');
const {default: Slack} = require('../lib/slackMock.ts');
const {promisify} = require('util');
const path = require('path');
const fs = require('fs');

jest.unmock('fs');

fs.virtualFiles = {
	[path.join(__dirname, 'data')]: '',
	[path.join(__dirname, 'data', 'ad.txt')]: [
		'丸い 1',
		'鋭い 1',
		...Array(100).fill().map((...[, i]) => `${i} 1`),
	].join('\n'),
	[path.join(__dirname, 'data', 'frequency.txt')]: [
		'丸い 1',
		'鋭い 1',
		...Array(100).fill().map((...[, i]) => `${i} 1`),
	].join('\n'),
	[path.join(__dirname, 'data', 'wiki_wakati.wv')]: '',
};

let slack = null;

describe('vocabwar', () => {
	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await vocabwar(slack);
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
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
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await vocabwar(slack);
		jest.useFakeTimers();
		await slack.getResponseTo('弓箭 丸い');
	});

	afterEach(() => {
		jest.useRealTimers();
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

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: '鋭い',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	}));

	it('rejects duplicate answer', () => new Promise((resolve, reject) => {
		slack.on('chat.postMessage', ({text}) => {
			expect(text).toContain('パク');
			resolve();
		});

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: '鋭い',
			user: `${slack.fakeUser}hoge`,
			ts: slack.fakeTimestamp,
		});
	}));

	/* currently unavailable because of slackMock.handleWebcall
	it('posts result', () => new Promise((resolve, reject) => {
		slack.on('chat.postMessage', ({text}) => {
			expect(text).toContain('結果');
			resolve();
		});
	}));
	*/
});
