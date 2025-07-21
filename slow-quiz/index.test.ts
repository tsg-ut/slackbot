/* eslint-disable init-declarations */
/* eslint-env jest */

import type {MockedStateInterface} from '../lib/__mocks__/state';
import openai from '../lib/openai';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {SlowQuiz, validateQuestion, type StateObj, type Game} from './index';

process.env.OPENAI_API_KEY = 'test-api-key';

jest.mock('../lib/state');
jest.mock('../lib/slackUtils', () => ({
	getEmoji: jest.fn(() => 'https://example.com/emoji.png'),
	getMemberIcon: jest.fn(() => Promise.resolve('https://example.com/icon.png')),
	getMemberName: jest.fn(() => Promise.resolve('Test User')),
}));
jest.mock('../lib/openai', () => ({
	__esModule: true,
	default: {
		chat: {
			completions: {
				create: jest.fn(),
			},
		},
		batches: {
			create: jest.fn(),
			retrieve: jest.fn(),
		},
		files: {
			create: jest.fn(),
		},
	},
}));
jest.mock('node-schedule', () => ({
	scheduleJob: jest.fn(),
}));

const MockedState = State as MockedStateInterface<StateObj>;

const now = Date.now();

const getBaseGame = (): Game => ({
	id: 'test-game',
	status: 'waitlisted',
	author: 'U123456789',
	question: '日本一高い山は何？',
	answer: '富士山',
	ruby: 'ふじさん,ふじやま',
	hint: '答えはかな4文字',
	registrationDate: now - 1000,
	startDate: null,
	finishDate: null,
	progress: 0,
	progressOfComplete: 8,
	completed: false,
	days: 0,
	correctAnswers: [],
	wrongAnswers: [],
	comments: [],
	answeredUsers: [],
	genre: 'normal',
});

describe('slow-quiz', () => {
	let slack: Slack;
	let slowQuiz: SlowQuiz;

	beforeEach(async () => {
		jest.clearAllMocks();
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		process.env.CHANNEL_QUIZ = slack.fakeChannel;

		jest.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{
				// @ts-expect-error: Mocking only the necessary properties
				message: {
					content: '【テスト解答（てすとかいとう）】',
				},
			}],
			model: 'gpt-4o-mini',
		});
		// @ts-expect-error: Mocking only the necessary properties
		jest.mocked(openai.batches.create).mockResolvedValue({
			id: 'batch-123',
		});
		// @ts-expect-error: Mocking only the necessary properties
		jest.mocked(openai.batches.retrieve).mockResolvedValue({
			status: 'completed',
		});
		// @ts-expect-error: Mocking only the necessary properties
		jest.mocked(openai.files.create).mockResolvedValue({
			id: 'file-123',
		});

		slowQuiz = new SlowQuiz({
			slack: slack.webClient,
			slackInteractions: slack.messageClient,
		});
		await slowQuiz.initialize();
	});

	describe('validateQuestion', () => {
		it('should validate short questions correctly', () => {
			expect(validateQuestion('日本一高い山は何？')).toBe(true);
			expect(validateQuestion('a'.repeat(90))).toBe(true);
			expect(validateQuestion('a'.repeat(91))).toBe(false);
		});

		it('should handle questions with special brackets', () => {
			expect(validateQuestion('日本一高い山【山梨県と静岡県の境にある】は何？')).toBe(true);
			expect(validateQuestion(`【説明文】${'a'.repeat(90)}`)).toBe(true);
		});

		it('should validate multi-part questions with slashes', () => {
			expect(validateQuestion('日本で/一番/高い/山は/何？')).toBe(true);
			expect(validateQuestion(`${'a'.repeat(20)}/${'b'.repeat(20)}/${'c'.repeat(20)}/${'d'.repeat(20)}/${'e'.repeat(20)}`)).toBe(true);
			const manyParts = Array(91).fill('a').join('/');
			expect(validateQuestion(manyParts)).toBe(false);
		});

		it('should handle edge cases', () => {
			expect(validateQuestion('')).toBe(true);
			expect(validateQuestion('/')).toBe(true);
			expect(validateQuestion(`a/b/c/${'d'.repeat(85)}`)).toBe(false);
		});
	});

	describe('SlowQuiz class', () => {
		it('should initialize correctly', () => {
			const state = MockedState.mocks.get('slow-quiz');
			expect(state.games).toEqual([]);
			expect(state.latestStatusMessages).toEqual([]);
			expect(state.batchJobs).toEqual([]);
		});

		describe('progressGames', () => {
			it('should start a new game from waitlist', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					...getBaseGame(),
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(testGame).toEqual({
					...getBaseGame(),
					status: 'inprogress',
					startDate: expect.any(Number),
					progress: 1,
					days: 1,
					answeredUsers: ['bot:chatgpt-4o-mini:ver1'],
					comments: [
						{
							answer: '【テスト解答（てすとかいとう）】',
							date: expect.any(Number),
							days: 1,
							progress: 1,
							user: 'bot:chatgpt-4o-mini:ver1',
						},
					],
					wrongAnswers: [
						{
							answer: 'てすとかいとう',
							date: expect.any(Number),
							days: 1,
							progress: 1,
							user: 'bot:chatgpt-4o-mini:ver1',
						},
					],
				});
				expect(testGame.startDate).toBeGreaterThan(0);
			});

			it('should progress existing games', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const startDate = Date.now() - 2000;
				const answerDate = Date.now() - 1000;
				const testGame: Game = {
					...getBaseGame(),
					status: 'inprogress',
					startDate,
					progress: 2,
					days: 2,
					wrongAnswers: [{
						user: 'U123456789',
						progress: 1,
						days: 1,
						date: answerDate,
						answer: 'ふじ',
					}],
					answeredUsers: ['U123456789'],
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(testGame).toEqual({
					...getBaseGame(),
					status: 'inprogress',
					startDate,
					progress: 3,
					days: 3,
					comments: [
						{
							answer: '【テスト解答（てすとかいとう）】',
							date: expect.any(Number),
							days: 3,
							progress: 3,
							user: 'bot:chatgpt-4o-mini:ver1',
						},
					],
					wrongAnswers: [
						{
							user: 'U123456789',
							progress: 1,
							days: 1,
							date: answerDate,
							answer: 'ふじ',
						},
						{
							user: 'bot:chatgpt-4o-mini:ver1',
							progress: 3,
							days: 3,
							date: expect.any(Number),
							answer: 'てすとかいとう',
						},
					],
					answeredUsers: ['bot:chatgpt-4o-mini:ver1'],
				});
			});

			it('should mark game as complete when progress reaches progressOfComplete', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const startDate = Date.now() - 1000;
				const testGame: Game = {
					...getBaseGame(),
					status: 'inprogress',
					startDate,
					progress: 7,
					days: 7,
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(testGame).toEqual({
					...getBaseGame(),
					status: 'inprogress',
					startDate,
					completed: true,
					progress: 8,
					days: 8,
					correctAnswers: [],
					wrongAnswers: [
						{
							answer: 'てすとかいとう',
							date: expect.any(Number),
							days: 8,
							progress: 8,
							user: 'bot:chatgpt-4o-mini:ver1',
						},
					],
					comments: [
						{
							answer: '【テスト解答（てすとかいとう）】',
							date: expect.any(Number),
							days: 8,
							progress: 8,
							user: 'bot:chatgpt-4o-mini:ver1',
						},
					],
					answeredUsers: ['bot:chatgpt-4o-mini:ver1'],
				});
			});

			it('should handle games with bracket endings in progress', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					...getBaseGame(),
					status: 'inprogress',
					startDate: Date.now() - 2000,
					question: '小説『吾輩は猫である』の著者は誰？',
					progress: 2,
					days: 2,
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				// Should increment by 2 when hitting a bracket character
				expect(state.games[0].progress).toBe(4);
			});
		});

		describe('game selection logic', () => {
			it('should prioritize users who have never been selected', async () => {
				const state = MockedState.mocks.get('slow-quiz');

				// Game from a user who has been selected before
				const oldGame: Game = {
					...getBaseGame(),
					id: 'old-game',
					status: 'finished',
					author: 'U111111111',
					registrationDate: Date.now() - 5000,
					startDate: Date.now() - 4000,
					finishDate: Date.now() - 1000,
					progress: 8,
					days: 8,
					completed: true,
				};

				// Waitlisted game from same user
				const waitlistedGameFromOldUser: Game = {
					...getBaseGame(),
					id: 'waitlisted-old-user',
					status: 'waitlisted',
					author: 'U111111111',
					registrationDate: Date.now() - 3000,
					startDate: null,
					finishDate: null,
					progress: 0,
					days: 0,
					completed: false,
				};

				// Waitlisted game from new user
				const waitlistedGameFromNewUser: Game = {
					...getBaseGame(),
					id: 'waitlisted-new-user',
					status: 'waitlisted',
					author: 'U222222222',
					registrationDate: Date.now() - 2000,
					startDate: null,
					finishDate: null,
					progress: 0,
					days: 0,
					completed: false,
				};

				state.games.push(oldGame, waitlistedGameFromOldUser, waitlistedGameFromNewUser);

				await slowQuiz.progressGames();

				// New user's game should be selected
				const inProgressGame = state.games.find((game) => game.status === 'inprogress');
				expect(inProgressGame).toBeDefined();
				expect(inProgressGame?.id).toBe('waitlisted-new-user');
			});
		});

		describe('checkBatchJobs', () => {
			it('should handle empty batch jobs array', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				expect(state.batchJobs).toEqual([]);

				await expect(slowQuiz.checkBatchJobs()).resolves.not.toThrow();
			});

			it('should not process completed batch jobs', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				state.batchJobs.push({
					id: 'batch-123',
					gameId: 'game-123',
					model: 'o4-mini',
					status: 'completed',
					createdAt: Date.now() - 1000,
					completedAt: Date.now(),
					response: 'Test response',
					answer: 'テスト答え',
				});

				await expect(slowQuiz.checkBatchJobs()).resolves.not.toThrow();
			});
		});
	});
});
