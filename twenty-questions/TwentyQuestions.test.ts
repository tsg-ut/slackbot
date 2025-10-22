/* eslint-env jest */

import crypto from 'crypto';
import type {MockedStateInterface} from '../lib/__mocks__/state';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {TwentyQuestions, type StateObj} from './TwentyQuestions';
import openai from '../lib/openai';
import {getCandidateWords} from '../lib/candidateWords';

jest.mock('axios');
jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
jest.mock('../lib/openai');
jest.mock('../lib/firestore');
jest.mock('../lib/candidateWords');
jest.mock('../achievements');
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

		const postMessage = jest.mocked(slack.webClient.chat.postMessage);
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: slack.fakeTimestamp,
		});

		const state = MockedState.mocks.get('twenty-questions');
		await twentyQuestions.startGame(slack.fakeUser);

		const mockedPostMessage = jest.mocked(slack.webClient.chat.postMessage);

		expect(state.currentGame).not.toBe(null);
		expect(state.currentGame?.status).toBe('active');
		expect(state.currentGame?.topic).toBe('テスト');

		// 10回の選択 + 最終選択で11回
		expect(mockedChatCompletionsCreate).toHaveBeenCalledTimes(11);
		expect(mockedGetCandidateWords).toHaveBeenCalledTimes(1);

		expect(mockedPostMessage).toHaveBeenCalledTimes(1);
		expect(mockedPostMessage).toHaveBeenCalledWith(expect.objectContaining({
			channel: slack.fakeChannel,
			blocks: expect.any(Array),
			text: '20の扉ゲーム開始！',
		}));
	});

	it('prevents starting game when one is already active', async () => {
		const state = MockedState.mocks.get('twenty-questions');
		state.currentGame = {
			id: 'game-1',
			topic: 'りんご',
			status: 'active',
			startedAt: Date.now(),
			finishedAt: null,
			players: {},
			statusMessageTs: '1234567890.123456',
		};

		const postEphemeral = jest.mocked(
			slack.webClient.chat.postEphemeral,
		);
		postEphemeral.mockResolvedValueOnce({
			ok: true,
		});

		await twentyQuestions.startGame(slack.fakeUser);

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
});
