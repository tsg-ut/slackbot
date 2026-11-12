import axios from 'axios';
import pocky from './index.js';
import Slack from '../lib/slackMock';

vi.mock('axios');
vi.mock('../achievements');
vi.mock('../lib/slack');
vi.mock('../lib/slackUtils');
vi.mock('../lib/state');
vi.mock('../lib/openai');

const mockedAxios = axios as unknown as {response: unknown};

let slack: InstanceType<typeof Slack> = null;

const expectNoResponse = async (message: string, options = {}) => {
	const postMessage = vi.fn();
	slack.on('chat.postMessage', postMessage);

	slack.postMessage(message, options);
	await new Promise((resolve) => setTimeout(resolve, 50));

	expect(postMessage).not.toHaveBeenCalled();
};

describe('pocky', () => {
	beforeEach(() => {
		mockedAxios.response = {data: [null, ['ほげ ふが']]};
	});

	describe('in the sandbox channel', () => {
		beforeEach(async () => {
			slack = new Slack();
			process.env.CHANNEL_SANDBOX = slack.fakeChannel;
			process.env.CHANNEL_GAMES = 'CGAMES';
			await pocky(slack);
		});

		it('responds to "ほげ?"', async () => {
			const message = await slack.getResponseTo('ほげ?');

			expect('username' in message && message.username).toBe('pocky');
			expect(message.text).toBe('ふが');
		});

		it('responds to "ほげ?" in a thread', async () => {
			const message = await slack.getResponseTo('ほげ?', {thread_ts: '1234567890.000001'});

			expect(message.text).toBe('ふが');
			expect(message.thread_ts).toBe('1234567890.000001');
		});
	});

	describe('in the games channel', () => {
		beforeEach(async () => {
			slack = new Slack();
			process.env.CHANNEL_SANDBOX = 'CSANDBOX';
			process.env.CHANNEL_GAMES = slack.fakeChannel;
			await pocky(slack);
		});

		it('responds to "ほげ?"', async () => {
			const message = await slack.getResponseTo('ほげ?');

			expect(message.text).toBe('ふが');
		});

		it('does not respond to "ほげ?" in a thread', async () => {
			await expectNoResponse('ほげ?', {thread_ts: '1234567890.000001'});
		});
	});

	describe('in other channels', () => {
		beforeEach(async () => {
			slack = new Slack();
			process.env.CHANNEL_SANDBOX = 'CSANDBOX';
			process.env.CHANNEL_GAMES = 'CGAMES';
			await pocky(slack);
		});

		it('does not respond to "ほげ?"', async () => {
			await expectNoResponse('ほげ?');
		});
	});
});
