import vocabwar from './index.js';
import Slack from '../lib/slackMock';
import path from 'path';
import fs from 'fs';

vi.mock('axios');
vi.mock('fs');
vi.mock('word2vec');
vi.mock('../lib/download');
vi.mock('./state.json', () => ({}));

(fs as any).virtualFiles = {
	[path.join(__dirname, 'data')]: '',
	[path.join(__dirname, 'data', 'ad.txt')]: [
		'丸い 1',
		'鋭い 1',
		...Array(100).fill(null).map((...[, i]) => `${i} 1`),
	].join('\n'),
	[path.join(__dirname, 'data', 'frequency.txt')]: [
		'丸い 1',
		'鋭い 1',
		...Array(100).fill(null).map((...[, i]) => `${i} 1`),
	].join('\n'),
	[path.join(__dirname, 'data', 'wiki_wakati.wv')]: '',
};

let slack: InstanceType<typeof Slack> = null;

describe('vocabwar', () => {
	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await vocabwar(slack);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('responds to "弓箭"', async () => {
		const message = await slack.getResponseTo('弓箭');

		expect('username' in message && message.username).toBe('vocabwar');
		expect(message.text).toContain('弓箭');
		expect('attachments' in message && message.attachments).toHaveLength(10);
	});

	it('responds to "即弓箭"', async () => {
		const message = await slack.getResponseTo('即弓箭');

		expect('username' in message && message.username).toBe('vocabwar');
		expect(message.text).toContain('弓箭');
		expect(message.text).toContain('終了予定時刻');
	});

	it('responds to "弓箭 お題"', async () => {
		const message = await slack.getResponseTo('弓箭 丸い');

		expect('username' in message && message.username).toBe('vocabwar');
		expect(message.text).toContain('弓箭');
		expect(message.text).toContain('終了予定時刻');
		expect(message.text).toContain('丸い');
	});

	it('does not set unknown words to theme by "弓箭 お題"', async () => {
		const message = await slack.getResponseTo('弓箭 んをわろれるりら');
		expect('username' in message && message.username).toBe('vocabwar');
		expect(message.text).toContain('知らない');
		expect(message.text).not.toContain('決定');
	});
});

describe('vocabwar', () => {
	beforeAll(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await vocabwar(slack);
		vi.useFakeTimers();
		await slack.getResponseTo('弓箭 丸い');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('rejects the same word as theme', async () => {
		const message = await slack.getResponseTo('丸い');
		expect('username' in message && message.username).toBe('vocabwar');
		expect(message.text).toContain('お題');
	});

	it('rejects unknown word', async () => {
		const message = await slack.getResponseTo('んをわろれるりら');
		expect('username' in message && message.username).toBe('vocabwar');
		expect(message.text).toContain('知らない');
	});

	it('reacts "+1" to valid answer', () => new Promise<void>((resolve, reject) => {
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

	it('rejects duplicate answer', () => new Promise<void>((resolve, reject) => {
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
	it('posts result', () => new Promise<void>((resolve, reject) => {
		slack.on('chat.postMessage', ({text}) => {
			expect(message.text).toContain('結果');
			resolve();
		});
	}));
	*/
});
