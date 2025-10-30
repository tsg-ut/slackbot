/* eslint-env jest */

import type {MockedStateInterface} from '../lib/__mocks__/state';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {TwentyQuestions, type StateObj} from './TwentyQuestions';
import openai from '../lib/openai';
import {getCandidateWords} from '../lib/candidateWords';
import {increment} from '../achievements';
import { BlockAction, BlockElementAction } from '@slack/bolt';

jest.mock('axios');
jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
jest.mock('../lib/openai');
jest.mock('../lib/firestore');
jest.mock('../lib/candidateWords');
jest.mock('../achievements', () => ({
	increment: jest.fn(),
}));
jest.mock('../lib/slack', () => ({
	webClient: {},
	eventClient: {},
	messageClient: {},
}));
jest.mock('crypto', () => ({
	randomUUID: jest.fn(() => 'test-uuid'),
}));

const MockedState = State as MockedStateInterface<StateObj>;
const mockedChatCompletionsCreate = jest.mocked(openai.chat.completions.create);
const mockedGetCandidateWords = jest.mocked(getCandidateWords);
const mockedIncrement = jest.mocked(increment);

describe('twenty-questions', () => {
	let slack: Slack = null;
	let twentyQuestions: TwentyQuestions = null;

	beforeEach(async () => {
		jest.clearAllMocks();

		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;

		twentyQuestions = await TwentyQuestions.create(slack);
	});

	it('initializes correctly', () => {
		const state = MockedState.mocks.get('twenty-questions');
		expect(state.currentGame).toBe(null);
	});

	it('responds to "20の扉" message', async () => {
		mockedChatCompletionsCreate.mockResolvedValue({
			id: 'test-chat-completion-id',
			created: Date.now(),
			model: '',
			object: 'chat.completion',
			choices: [
				{
					message: {
						content: 'テスト',
						refusal: '',
						role: 'assistant',
					},
					finish_reason: 'stop',
					index: 0,
					logprobs: null,
				},
			],
		});

		mockedGetCandidateWords.mockResolvedValueOnce([
			['テスト', 'てすと', 'wikipedia'],
			['別の単語', 'べつのたんご', 'wikipedia'],
		]);

		const postEphemeral = jest.mocked(slack.webClient.chat.postEphemeral);
		postEphemeral.mockResolvedValueOnce({
			ok: true,
		});

		const postMessage = jest.mocked(slack.webClient.chat.postMessage);
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: slack.fakeTimestamp,
		});

		const state = MockedState.mocks.get('twenty-questions');
		await twentyQuestions.startGame(slack.fakeUser);

		const mockedPostEphemeral = jest.mocked(
			slack.webClient.chat.postEphemeral,
		);
		const mockedPostMessage = jest.mocked(slack.webClient.chat.postMessage);

		expect(state.currentGame).not.toBe(null);
		expect(state.currentGame?.status).toBe('active');
		expect(state.currentGame?.topic).toBe('テスト');
		expect(state.currentGame?.topicDescription).toContain('テスト');
		expect(state.currentGame?.topicDescription).toContain('文字数:');
		expect(state.currentGame?.topicDescription).toContain('読みの文字数:');

		// 10回の選択 + 最終選択 + データシート生成で12回
		expect(mockedChatCompletionsCreate).toHaveBeenCalledTimes(12);
		expect(mockedGetCandidateWords).toHaveBeenCalledTimes(1);

		expect(mockedPostEphemeral).toHaveBeenCalledTimes(1);
		expect(mockedPostEphemeral).toHaveBeenCalledWith({
			channel: slack.fakeChannel,
			user: slack.fakeUser,
			text: 'お題を選択中です⋯⋯',
		});

		expect(mockedPostMessage).toHaveBeenCalledTimes(1);
		expect(mockedPostMessage).toHaveBeenCalledWith(expect.objectContaining({
			channel: slack.fakeChannel,
			blocks: expect.any(Array),
			text: '20の扉ゲーム開始！',
		}));
	});

	describe('when game is active', () => {
		beforeEach(() => {
			const state = MockedState.mocks.get('twenty-questions');
			state.currentGame = {
				id: 'game-1',
				topic: 'りんご',
				topicRuby: 'りんご',
				topicDescription: 'テスト説明',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {
					[slack.fakeUser]: {
						userId: slack.fakeUser,
						questions: [],
						questionCount: 0,
						isFinished: false,
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			};
		});

		it('prevents starting game', async () => {
			const postEphemeral = jest.mocked(
				slack.webClient.chat.postEphemeral,
			);
			postEphemeral.mockResolvedValueOnce({
				ok: true,
			});

			await twentyQuestions.startGame(slack.fakeUser);

			const state = MockedState.mocks.get('twenty-questions');

			const mockedPostEphemeral = jest.mocked(
				slack.webClient.chat.postEphemeral,
			);

			expect(state.currentGame.id).toBe('game-1');
			expect(mockedPostEphemeral).toHaveBeenCalledTimes(1);
			expect(mockedPostEphemeral).toHaveBeenCalledWith({
				channel: slack.fakeChannel,
				user: slack.fakeUser,
				text: '既に進行中のゲームがあります。',
			});
		});

		it('handles question submission', async () => {
			mockedChatCompletionsCreate.mockResolvedValue({
				id: 'test-chat-completion-id',
				created: Date.now(),
				model: '',
				object: 'chat.completion',
				choices: [
					{
						message: {
							content: 'はい',
							refusal: '',
							role: 'assistant',
						},
						finish_reason: 'stop',
						index: 0,
						logprobs: null,
					},
				],
			});

			const chatUpdate = jest.mocked(slack.webClient.chat.update);
			chatUpdate.mockResolvedValueOnce({
				ok: true,
			});

			const viewsUpdate = jest.mocked(slack.webClient.views.update);
			viewsUpdate.mockResolvedValueOnce({
				ok: true,
			});

			const payload: BlockAction<BlockElementAction> = {
				type: 'block_actions',
				user: { id: slack.fakeUser, name: 'testuser' },
				view: {
					id: 'test-view-id',
					state: {
						values: {
							question_input: {
								question_input_field: {
									type: 'plain_text_input',
									value: 'それは生き物ですか？',
								},
							},
						},
					},
				},
				actions: [
					{
						type: 'button',
						action_id: 'twenty_questions_submit_question',
					},
				],
			} as any;

			await slack.messageClient.sendAction(payload);

			const mockedChatUpdate = jest.mocked(slack.webClient.chat.update);
			const mockedViewsUpdate = jest.mocked(slack.webClient.views.update);

			const state = MockedState.mocks.get('twenty-questions');
			const player = state.currentGame.players[slack.fakeUser];

			expect(player.questionCount).toBe(1);
			expect(player.questions).toHaveLength(1);
			expect(player.questions[0].question).toBe('それは生き物ですか？');
			expect(player.questions[0].answer).toBe('はい');

			expect(mockedIncrement).toBeCalledWith(
				slack.fakeUser,
				'twenty-questions-ask-question',
			);

			expect(mockedChatUpdate).toHaveBeenCalledTimes(1);
			expect(mockedChatUpdate).toHaveBeenCalledWith(expect.objectContaining({
				channel: slack.fakeChannel,
				ts: '1234567890.123456',
				blocks: expect.arrayContaining([
					expect.objectContaining({
						text: expect.objectContaining({
							text: expect.stringContaining('＊未正解:＊ <@U00000000>'),
						}),
					}),
				]),
			}));

			expect(mockedViewsUpdate).toHaveBeenCalledTimes(1);
			expect(mockedViewsUpdate).toHaveBeenCalledWith(expect.objectContaining({
				view_id: 'test-view-id',
				view: expect.objectContaining({
					blocks: expect.arrayContaining([
						expect.objectContaining({
							type: 'section',
							text: expect.objectContaining({
								text: expect.stringContaining('Q1: それは生き物ですか？\nA1: はい'),
							}),
						}),
						expect.objectContaining({
							type: 'section',
							text: expect.objectContaining({
								text: expect.stringContaining('質問回数: 1 / 20'),
							}),
						}),
					]),
				}),
			}));
		});
	});
});
