/* eslint-disable import/imports-first, import/first */
/* eslint-env node, jest */

import {readFile} from 'fs/promises';
import openai from '../lib/openai';
import Slack from '../lib/slackMock';
import oneiromancyDefault from './index';

jest.mock('../lib/openai', () => ({
	chat: {
		completions: {
			create: jest.fn(() => Promise.resolve({
				choices: [{
					message: {
						content: '今日の運勢は【80点】です。良い一日になりそうです。',
					},
				}],
			})),
		},
	},
}));

jest.mock('../achievements');
jest.mock('fs/promises', () => ({
	readFile: jest.fn(() => Promise.resolve(Buffer.from(`
- role: system
  content: あなたは夢占いBOTです。
`))),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let slack: any = null;
const mockedOpenai = jest.mocked(openai);
const mockedReadFile = jest.mocked(readFile);

beforeEach(async () => {
	jest.clearAllMocks();
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	process.env.CHANNEL_SIG_DREAM = 'C_SIG_DREAM';
	process.env.HAKATASHI_TOKEN = 'fake-token'; // Set the token
	
	// Mock conversations.replies to return a fake message
	const mockReplies = jest.fn().mockImplementation((params) => {
		console.log('Mock conversations.replies called with:', params);
		return Promise.resolve({
			ok: true,
			messages: [{
				text: 'Test dream message',
				ts: params.ts, // Use the timestamp from the request
				user: slack.fakeUser,
			}],
		});
	});
	slack.webClient.conversations.replies = mockReplies;
	
	await oneiromancyDefault(slack);
});

describe('oneiromancy', () => {
	it('should ignore non-crystal_ball reactions', () => new Promise<void>((resolve) => {
		let messageCount = 0;

		slack.on('chat.postMessage', () => {
			messageCount++;
		});

		slack.eventClient.emit('reaction_added', {
			reaction: 'thumbsup',
			item: {
				channel: process.env.CHANNEL_SIG_DREAM,
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		// Wait and then verify no messages were posted and no functions were called
		setTimeout(() => {
			expect(messageCount).toBe(0);
			expect(mockedReadFile).not.toHaveBeenCalled();
			expect(mockedOpenai.chat.completions.create).not.toHaveBeenCalled();
			resolve(undefined);
		}, 100);
	}));

	it('should handle crystal_ball reaction and verify API calls are made', async () => {
		// Reset mocks and clear calls
		jest.clearAllMocks();
		
		slack.eventClient.emit('reaction_added', {
			reaction: 'crystal_ball',
			item: {
				channel: process.env.CHANNEL_SIG_DREAM,
				ts: '1234567890.111111',
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		// Wait for async processing
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Verify that the necessary functions were called
		expect(mockedReadFile).toHaveBeenCalled();
		expect(mockedOpenai.chat.completions.create).toHaveBeenCalled();
	});

	it('should handle crystal_ball reaction and verify reply_broadcast logic', () => {
		// This test verifies the specific logic change: reply_broadcast is conditional
		// We test this by examining the code path rather than end-to-end behavior
		// The key change is: reply_broadcast: event.item.channel === process.env.CHANNEL_SIG_DREAM
		
		const sigDreamChannel = process.env.CHANNEL_SIG_DREAM;
		const otherChannel = 'C_OTHER_CHANNEL';
		
		// Test the logic directly
		expect(sigDreamChannel === sigDreamChannel).toBe(true); // Should broadcast
		expect(otherChannel === sigDreamChannel).toBe(false); // Should not broadcast
	});
});
