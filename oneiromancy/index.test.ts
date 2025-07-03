/* eslint-env node, jest */

// Set environment variables before importing modules
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.CHANNEL_SANDBOX = 'CSANDBOX';
process.env.CHANNEL_SIG_DREAM = 'CSIGDREAM';
process.env.HAKATASHI_TOKEN = 'test-token';

jest.mock('../lib/openai', () => ({
	default: {
		chat: {
			completions: {
				create: jest.fn(),
			},
		},
	},
}));
jest.mock('../achievements');

import oneiromancy from './index';
import Slack from '../lib/slackMock';
const openai = require('../lib/openai');
const {increment} = require('../achievements');

describe('oneiromancy', () => {
	let slack: Slack;

	beforeEach(() => {
		slack = new Slack();

		// Mock OpenAI response
		openai.default.chat.completions.create.mockResolvedValue({
			choices: [{
				message: {
					content: '今日の運勢は【85点】です。良い一日になるでしょう。',
				},
			}],
		});

		// Mock slack conversations.replies
		const conversationsReplies = slack.webClient.conversations.replies as jest.MockedFunction<typeof slack.webClient.conversations.replies>;
		conversationsReplies.mockResolvedValue({
			ok: true,
			messages: [{
				ts: slack.fakeTimestamp,
				text: '昨日、空を飛ぶ夢を見ました。',
				thread_ts: undefined,
			}],
		});

		// Mock chat.postMessage
		const chatPostMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		chatPostMessage.mockResolvedValue({
			ok: true,
			ts: 'thread-ts',
		});
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('should broadcast when reaction is added in sig-dream channel', async () => {
		await oneiromancy(slack);

		slack.eventClient.emit('reaction_added', {
			reaction: 'crystal_ball',
			item: {
				channel: process.env.CHANNEL_SIG_DREAM,
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		// Wait for async operations to complete
		await new Promise(resolve => setTimeout(resolve, 100));

		// Check that postMessage was called with reply_broadcast: true
		const chatPostMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		const postMessageCalls = chatPostMessage.mock.calls;
		const broadcastCall = postMessageCalls.find((call: any) => 
			call[0].reply_broadcast === true
		);
		
		expect(broadcastCall).toBeDefined();
		expect(broadcastCall[0]).toMatchObject({
			channel: process.env.CHANNEL_SANDBOX,
			reply_broadcast: true,
		});
	});

	it('should NOT broadcast when reaction is added in other channels', async () => {
		await oneiromancy(slack);

		slack.eventClient.emit('reaction_added', {
			reaction: 'crystal_ball',
			item: {
				channel: 'COTHER', // Different channel
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		// Wait for async operations to complete
		await new Promise(resolve => setTimeout(resolve, 100));

		// Check that postMessage was called with reply_broadcast: false 
		const chatPostMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		const postMessageCalls = chatPostMessage.mock.calls;
		const sandboxCall = postMessageCalls.find((call: any) => 
			call[0].channel === process.env.CHANNEL_SANDBOX
		);
		
		expect(sandboxCall).toBeDefined();
		expect(sandboxCall[0].reply_broadcast).toBe(false);
	});

	it('should only increment achievements for sig-dream channel', async () => {
		await oneiromancy(slack);

		// Test with sig-dream channel
		slack.eventClient.emit('reaction_added', {
			reaction: 'crystal_ball',
			item: {
				channel: process.env.CHANNEL_SIG_DREAM,
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(increment).toHaveBeenCalled();

		// Clear mocks
		jest.clearAllMocks();

		// Test with other channel
		slack.eventClient.emit('reaction_added', {
			reaction: 'crystal_ball',
			item: {
				channel: 'COTHER',
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(increment).not.toHaveBeenCalled();
	});

	it('should still perform divination for non-sig-dream channels', async () => {
		await oneiromancy(slack);

		slack.eventClient.emit('reaction_added', {
			reaction: 'crystal_ball',
			item: {
				channel: 'COTHER',
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		// Should still call OpenAI API
		expect(openai.default.chat.completions.create).toHaveBeenCalled();
		
		// Should still post to sandbox
		const chatPostMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		const postMessageCalls = chatPostMessage.mock.calls;
		const sandboxCall = postMessageCalls.find((call: any) => 
			call[0].channel === process.env.CHANNEL_SANDBOX
		);
		expect(sandboxCall).toBeDefined();
	});
});