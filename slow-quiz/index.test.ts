/* eslint-env jest */

import {jest} from '@jest/globals';
import {SlackMessageAdapter} from '@slack/interactive-messages';
import type {WebClient} from '@slack/web-api';
import type {MockedStateInterface} from '../lib/__mocks__/state';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {SlowQuiz, getGenreText, validateQuestion, type StateObj, type Game, type Genre} from './index';

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

describe('slow-quiz', () => {
	let slack: Slack;
	let slowQuiz: SlowQuiz;

	beforeEach(async () => {
		jest.clearAllMocks();
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		process.env.CHANNEL_QUIZ = slack.fakeChannel;

		// Mock OpenAI API responses
		const openai = require('../lib/openai');
		openai.default.chat.completions.create.mockResolvedValue({
			choices: [{
				message: {
					content: '【テスト答え】（てすとこたえ）',
				},
			}],
			model: 'gpt-4o-mini',
		});
		openai.default.batches.create.mockResolvedValue({
			id: 'batch-123',
		});
		openai.default.batches.retrieve.mockResolvedValue({
			status: 'completed',
		});
		openai.default.files.create.mockResolvedValue({
			id: 'file-123',
		});

		slowQuiz = new SlowQuiz({
			slack: slack.webClient as WebClient,
			slackInteractions: slack.messageClient as SlackMessageAdapter,
		});
		await slowQuiz.initialize();
	});

	describe('getGenreText', () => {
		it('should return correct text for normal genre', () => {
			expect(getGenreText('normal')).toBe('正統派');
		});

		it('should return correct text for strange genre', () => {
			expect(getGenreText('strange')).toBe('変化球');
		});

		it('should return correct text for anything genre', () => {
			expect(getGenreText('anything')).toBe('なんでも');
		});
	});

	describe('validateQuestion', () => {
		it('should validate short questions correctly', () => {
			expect(validateQuestion('これは短い問題です')).toBe(true);
			expect(validateQuestion('a'.repeat(90))).toBe(true);
			expect(validateQuestion('a'.repeat(91))).toBe(false);
		});

		it('should handle questions with special brackets', () => {
			expect(validateQuestion('これは【特別な】問題です')).toBe(true);
			expect(validateQuestion(`【長い説明文】${'a'.repeat(90)}`)).toBe(true);
		});

		it('should validate multi-part questions with slashes', () => {
			expect(validateQuestion('part1/part2/part3/part4/part5')).toBe(true);
			expect(validateQuestion(`${'a'.repeat(15)}/${'b'.repeat(15)}/${'c'.repeat(15)}/${'d'.repeat(15)}/${'e'.repeat(15)}`)).toBe(true);
			const manyParts = Array(95).fill('a').join('/');
			expect(validateQuestion(manyParts)).toBe(false);
		});

		it('should handle edge cases', () => {
			expect(validateQuestion('')).toBe(true);
			expect(validateQuestion('/')).toBe(true);
			expect(validateQuestion('a/b/c/d')).toBe(true); // Less than 5 parts
		});
	});

	describe('SlowQuiz class', () => {
		it('should initialize correctly', () => {
			const state = MockedState.mocks.get('slow-quiz');
			expect(state.games).toEqual([]);
			expect(state.latestStatusMessages).toEqual([]);
			expect(state.batchJobs).toEqual([]);
		});

		it('should initialize with existing state', async () => {
			// Create a fresh state for this test
			const existingState: StateObj = {
				games: [{
					id: 'test-game',
					status: 'waitlisted',
					author: 'U123456789',
					question: 'テスト問題',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now(),
					startDate: null,
					finishDate: null,
					progress: 0,
					progressOfComplete: 5,
					completed: false,
					days: 0,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				}],
				latestStatusMessages: [],
				batchJobs: [],
			};

			// Create new instance with pre-populated state
			const testSlowQuiz = new SlowQuiz({
				slack: slack.webClient as WebClient,
				slackInteractions: slack.messageClient as SlackMessageAdapter,
			});

			// Override the state after initialization
			MockedState.mocks.set('slow-quiz', existingState);

			const state = MockedState.mocks.get('slow-quiz');
			expect(state.games).toHaveLength(1);
			expect(state.games[0].id).toBe('test-game');
		});

		describe('progressGames', () => {
			it('should start a new game from waitlist', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					id: 'test-game-1',
					status: 'waitlisted',
					author: 'U123456789',
					question: 'テスト問題',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now() - 1000,
					startDate: null,
					finishDate: null,
					progress: 0,
					progressOfComplete: 5,
					completed: false,
					days: 0,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(state.games[0].status).toBe('inprogress');
				expect(state.games[0].startDate).toBeGreaterThan(0);
				expect(state.games[0].progress).toBe(1);
				expect(state.games[0].days).toBe(1);
			});

			it('should progress existing games', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					id: 'test-game-1',
					status: 'inprogress',
					author: 'U123456789',
					question: 'テスト問題',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now() - 2000,
					startDate: Date.now() - 1000,
					finishDate: null,
					progress: 2,
					progressOfComplete: 5,
					completed: false,
					days: 2,
					correctAnswers: [{
						user: 'bot:chatgpt-4o-mini:ver1',
						progress: 1,
						days: 1,
						date: Date.now() - 500,
						answer: 'テストえ',
					}],
					wrongAnswers: [],
					comments: [],
					answeredUsers: ['U999999999'],
					genre: 'normal',
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(state.games[0].status).toBe('inprogress');
				expect(state.games[0].progress).toBe(3);
				expect(state.games[0].days).toBe(3);
				expect(state.games[0].answeredUsers).toEqual([]);
			});

			it('should complete game when progress reaches progressOfComplete', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					id: 'test-game-1',
					status: 'inprogress',
					author: 'U123456789',
					question: 'テスト',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now() - 2000,
					startDate: Date.now() - 1000,
					finishDate: null,
					progress: 2,
					progressOfComplete: 3,
					completed: false,
					days: 2,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(state.games[0].progress).toBe(3);
				expect(state.games[0].completed).toBe(true);
			});
		});

		describe('game selection logic', () => {
			it('should prioritize users who have never been selected', async () => {
				const state = MockedState.mocks.get('slow-quiz');

				// Game from a user who has been selected before
				const oldGame: Game = {
					id: 'old-game',
					status: 'finished',
					author: 'U111111111',
					question: '過去の問題',
					answer: '過去の答え',
					ruby: 'かこのこたえ',
					hint: null,
					registrationDate: Date.now() - 5000,
					startDate: Date.now() - 4000,
					finishDate: Date.now() - 1000,
					progress: 5,
					progressOfComplete: 5,
					completed: true,
					days: 5,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};

				// Waitlisted game from same user
				const waitlistedGameFromOldUser: Game = {
					id: 'waitlisted-old-user',
					status: 'waitlisted',
					author: 'U111111111',
					question: '待機中の問題（古いユーザー）',
					answer: '答え',
					ruby: 'こたえ',
					hint: null,
					registrationDate: Date.now() - 3000,
					startDate: null,
					finishDate: null,
					progress: 0,
					progressOfComplete: 5,
					completed: false,
					days: 0,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};

				// Waitlisted game from new user
				const waitlistedGameFromNewUser: Game = {
					id: 'waitlisted-new-user',
					status: 'waitlisted',
					author: 'U222222222',
					question: '待機中の問題（新しいユーザー）',
					answer: '答え',
					ruby: 'こたえ',
					hint: null,
					registrationDate: Date.now() - 2000,
					startDate: null,
					finishDate: null,
					progress: 0,
					progressOfComplete: 5,
					completed: false,
					days: 0,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
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

		describe('edge cases', () => {
			it('should handle games with bracket endings in progress', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					id: 'bracket-game',
					status: 'inprogress',
					author: 'U123456789',
					question: 'これは（テスト）問題です。',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now() - 2000,
					startDate: Date.now() - 1000,
					finishDate: null,
					progress: 3, // Should land on '（'
					progressOfComplete: 11,
					completed: false,
					days: 3,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				// Should increment by 2 when hitting a bracket character
				expect(state.games[0].progress).toBe(5);
			});

			it('should handle multi-part questions correctly', async () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					id: 'multi-part-game',
					status: 'inprogress',
					author: 'U123456789',
					question: 'パート1/パート2/パート3/パート4/パート5',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now() - 2000,
					startDate: Date.now() - 1000,
					finishDate: null,
					progress: 2,
					progressOfComplete: 5,
					completed: false,
					days: 2,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};
				state.games.push(testGame);

				await slowQuiz.progressGames();

				expect(state.games[0].progress).toBe(3);
				expect(state.games[0].days).toBe(3);
			});

			it('should handle empty question gracefully', () => {
				expect(validateQuestion('')).toBe(true);
			});

			it('should handle question with only brackets', () => {
				expect(validateQuestion('【】')).toBe(true);
			});
		});

		describe('comment functionality', () => {
			it('should initialize with empty comments array', () => {
				const state = MockedState.mocks.get('slow-quiz');
				const testGame: Game = {
					id: 'test-game-comment',
					status: 'inprogress',
					author: 'U123456789',
					question: 'テスト問題',
					answer: 'テスト答え',
					ruby: 'てすとこたえ',
					hint: null,
					registrationDate: Date.now() - 2000,
					startDate: Date.now() - 1000,
					finishDate: null,
					progress: 2,
					progressOfComplete: 5,
					completed: false,
					days: 2,
					correctAnswers: [],
					wrongAnswers: [],
					comments: [],
					answeredUsers: [],
					genre: 'normal',
				};
				state.games.push(testGame);

				// Verify the game has an empty comments array initially
				expect(state.games[0].comments).toEqual([]);
			});
		});
	});
});
