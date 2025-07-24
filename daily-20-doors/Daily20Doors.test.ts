/* eslint-disable import/imports-first, import/first */
/* eslint-env jest */

import crypto from 'crypto';
import type {MockedStateInterface} from '../lib/__mocks__/state';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {Daily20Doors, type StateObj} from './Daily20Doors';

jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
jest.mock('../lib/openai', () => ({
	__esModule: true,
	default: {
		chat: {
			completions: {
				create: jest.fn(),
			},
		},
	},
}));
jest.mock('crypto', () => ({
	randomUUID: jest.fn(() => 'test-uuid-daily20doors'),
}));

const MockedState = State as MockedStateInterface<StateObj>;
const mockedCrypto = jest.mocked(crypto);

describe('Daily20Doors', () => {
	let slack: Slack;
	let daily20doors: Daily20Doors;

	beforeEach(async () => {
		jest.clearAllMocks();

		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;

		daily20doors = await Daily20Doors.create(slack);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('initialization', () => {
		test('should initialize successfully', async () => {
			expect(mockedCrypto.randomUUID).toHaveBeenCalledTimes(1);

			const state = MockedState.mocks.get('daily-20-doors');
			expect(state.uuid).toBe('test-uuid-daily20doors');
			expect(state.currentWord).toBe(null);
			expect(state.userAttempts).toEqual([]);
		});

		test('should post daily challenge', async () => {
			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockResolvedValueOnce({
				ok: true,
				ts: slack.fakeTimestamp,
				channel: slack.fakeChannel,
			});

			await daily20doors.postDailyChallenge();

			expect(postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: slack.fakeChannel,
					username: '20の扉ゲーム',
					icon_emoji: ':door:',
					text: '本日の20の扉ゲームが始まりました！',
				}),
			);
		});
	});

	describe('daily word selection', () => {
		test('should select different words for different dates', async () => {
			// Mock two different days
			const originalDate = Date;

			// First day
			global.Date = jest.fn(() => new originalDate('2024-01-01T10:00:00Z')) as any;
			daily20doors['ensureDailyWord']();
			let state = MockedState.mocks.get('daily-20-doors');
			const firstWord = state.currentWord;

			// Second day
			global.Date = jest.fn(() => new originalDate('2024-01-02T10:00:00Z')) as any;
			daily20doors['ensureDailyWord']();
			state = MockedState.mocks.get('daily-20-doors');
			const secondWord = state.currentWord;

			expect(firstWord?.date).toBe('2024-01-01');
			expect(secondWord?.date).toBe('2024-01-02');
			expect(firstWord?.word).toBeDefined();
			expect(secondWord?.word).toBeDefined();

			global.Date = originalDate;
		});
	});

	describe('user interactions', () => {
		beforeEach(async () => {
			await daily20doors.initialize();
		});

		test('should handle start game button click', async () => {
			const payload = {
				user: {id: 'U12345', name: 'testuser'},
				trigger_id: 'trigger123',
			};

			const viewsOpen = slack.webClient.views.open as jest.MockedFunction<typeof slack.webClient.views.open>;

			// Simulate button click
			await daily20doors['startUserChallenge'](payload.user.id, payload.trigger_id);

			expect(viewsOpen).toHaveBeenCalledWith(
				expect.objectContaining({
					trigger_id: payload.trigger_id,
				}),
			);
		});

		test('should prevent multiple attempts on same day', async () => {
			const userId = 'U12345';
			const triggerId = 'trigger123';

			const viewsOpen = slack.webClient.views.open as jest.MockedFunction<typeof slack.webClient.views.open>;
			const postEphemeral = slack.webClient.chat.postEphemeral as jest.MockedFunction<typeof slack.webClient.chat.postEphemeral>;

			// First attempt
			await daily20doors['startUserChallenge'](userId, triggerId);
			expect(viewsOpen).toHaveBeenCalledTimes(1);

			// Complete the first attempt
			const state = MockedState.mocks.get('daily-20-doors');
			const attempt = state.userAttempts.find((a: any) => a.userId === userId);
			if (attempt) {
				attempt.completed = true;
				attempt.correctGuess = 'バナナ';
			}

			// Second attempt on same day
			await daily20doors['startUserChallenge'](userId, triggerId);

			// Should not open new dialog, but post ephemeral message
			expect(postEphemeral).toHaveBeenCalledWith(
				expect.objectContaining({
					user: userId,
					text: expect.stringContaining('本日のチャレンジは既に完了しています'),
				}),
			);
		});
	});

	describe('AI integration', () => {
		const mockOpenAI = require('../lib/openai').default;

		test('should get AI response for question', async () => {
			mockOpenAI.chat.completions.create.mockResolvedValue({
				choices: [{
					message: {
						content: 'はい',
					},
				}],
			});

			const word = {word: 'バナナ', reading: 'ばなな', date: '2024-01-01'};
			const response = await daily20doors['getAIResponse']('それは果物ですか？', word);

			expect(response).toBe('はい');
			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
				expect.objectContaining({
					model: 'gpt-4o-mini',
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: 'system',
						}),
						expect.objectContaining({
							role: 'user',
							content: expect.stringContaining('それは果物ですか？'),
						}),
					]),
				}),
			);
		});

		test('should validate guess correctly', async () => {
			mockOpenAI.chat.completions.create.mockResolvedValue({
				choices: [{
					message: {
						content: 'はい',
					},
				}],
			});

			const word = {word: 'バナナ', reading: 'ばなな', date: '2024-01-01'};
			const isCorrect = await daily20doors['checkGuess']('バナナ', word);

			expect(isCorrect).toBe(true);
		});

		test('should handle AI errors gracefully', async () => {
			mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

			const word = {word: 'バナナ', reading: 'ばなな', date: '2024-01-01'};
			const response = await daily20doors['getAIResponse']('それは果物ですか？', word);

			expect(response).toBe('わからない');
		});
	});

	describe('game flow', () => {
		beforeEach(async () => {
			await daily20doors.initialize();
		});

		test('should handle question submission', async () => {
			const userId = 'U12345';
			const question = 'それは黄色いですか？';
			const viewId = 'V12345';

			// Mock AI response
			const mockOpenAI = require('../lib/openai').default;
			mockOpenAI.chat.completions.create.mockResolvedValue({
				choices: [{
					message: {
						content: 'はい',
					},
				}],
			});

			// Create user attempt
			const state = MockedState.mocks.get('daily-20-doors');
			state.userAttempts.push({
				userId,
				date: '2024-01-01',
				questions: [],
				responses: [],
				completed: false,
				questionCount: 0,
			});

			await daily20doors['handleUserQuestion']({
				userId,
				question,
				viewId,
			});

			const attempt = state.userAttempts.find((a: any) => a.userId === userId);
			expect(attempt?.questions).toContain(question);
			expect(attempt?.responses).toContain('はい');
			expect(attempt?.questionCount).toBe(1);
		});

		test('should handle correct guess', async () => {
			const userId = 'U12345';
			const guess = 'バナナ';

			// Mock AI response for correct guess
			const mockOpenAI = require('../lib/openai').default;
			mockOpenAI.chat.completions.create.mockResolvedValue({
				choices: [{
					message: {
						content: 'はい',
					},
				}],
			});

			// Create user attempt
			const state = MockedState.mocks.get('daily-20-doors');
			state.currentWord = {word: 'バナナ', reading: 'ばなな', date: '2024-01-01'};
			state.userAttempts.push({
				userId,
				date: '2024-01-01',
				questions: ['それは果物ですか？'],
				responses: ['はい'],
				completed: false,
				questionCount: 1,
			});

			await daily20doors['handleUserGuess']({userId, guess});

			const attempt = state.userAttempts.find((a: any) => a.userId === userId);
			expect(attempt?.completed).toBe(true);
			expect(attempt?.correctGuess).toBe(guess);

			// Should announce success
			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			expect(postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining('成功しました'),
				}),
			);
		});

		test('should limit questions to 20', async () => {
			const userId = 'U12345';
			const viewId = 'V12345';

			// Create user attempt with 20 questions already
			const state = MockedState.mocks.get('daily-20-doors');
			state.userAttempts.push({
				userId,
				date: '2024-01-01',
				questions: Array(20).fill('質問'),
				responses: Array(20).fill('はい'),
				completed: false,
				questionCount: 20,
			});

			await daily20doors['handleUserQuestion']({
				userId,
				question: '21番目の質問',
				viewId,
			});

			// Should show game over
			const postEphemeral = slack.webClient.chat.postEphemeral as jest.MockedFunction<typeof slack.webClient.chat.postEphemeral>;
			expect(postEphemeral).toHaveBeenCalledWith(
				expect.objectContaining({
					user: userId,
					text: expect.stringContaining('残念'),
				}),
			);
		});
	});
});

