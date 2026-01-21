"use strict";
/* eslint-env jest */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const state_1 = __importDefault(require("../lib/state"));
const TwentyQuestions_1 = require("./TwentyQuestions");
const openai_1 = __importDefault(require("../lib/openai"));
const candidateWords_1 = require("../lib/candidateWords");
const achievements_1 = require("../achievements");
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
const MockedState = state_1.default;
const mockedChatCompletionsCreate = jest.mocked(openai_1.default.chat.completions.create);
const mockedGetCandidateWords = jest.mocked(candidateWords_1.getCandidateWords);
const mockedIncrement = jest.mocked(achievements_1.increment);
describe('twenty-questions', () => {
    let slack = null;
    let twentyQuestions = null;
    beforeEach(async () => {
        jest.clearAllMocks();
        slack = new slackMock_1.default();
        process.env.CHANNEL_SANDBOX = slack.fakeChannel;
        twentyQuestions = await TwentyQuestions_1.TwentyQuestions.create(slack);
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
        const mockedPostEphemeral = jest.mocked(slack.webClient.chat.postEphemeral);
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
            const postEphemeral = jest.mocked(slack.webClient.chat.postEphemeral);
            postEphemeral.mockResolvedValueOnce({
                ok: true,
            });
            await twentyQuestions.startGame(slack.fakeUser);
            const state = MockedState.mocks.get('twenty-questions');
            const mockedPostEphemeral = jest.mocked(slack.webClient.chat.postEphemeral);
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
            const payload = {
                type: 'block_actions',
                user: {
                    id: slack.fakeUser,
                    name: 'testuser',
                    username: 'testuser',
                },
                team: null,
                view: {
                    id: 'test-view-id',
                    type: 'modal',
                    callback_id: '',
                    team_id: slack.fakeTeam,
                    app_id: 'test-app-id',
                    bot_id: 'test-bot-id',
                    title: {
                        type: 'plain_text',
                        text: 'Test Modal',
                        emoji: true,
                    },
                    blocks: [],
                    close: null,
                    submit: null,
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
                    hash: 'test-hash',
                    private_metadata: '',
                    root_view_id: 'test-view-id',
                    previous_view_id: null,
                    clear_on_close: false,
                    notify_on_close: false,
                },
                actions: [
                    {
                        type: 'button',
                        action_id: 'twenty_questions_submit_question',
                        block_id: 'test-block-id',
                        action_ts: '1234567890.123456',
                        text: {
                            type: 'plain_text',
                            text: 'Submit',
                            emoji: true,
                        },
                    },
                ],
                token: 'test-token',
                response_url: 'https://hooks.slack.com/actions/test',
                trigger_id: 'test-trigger-id',
                api_app_id: 'test-app-id',
                container: {
                    type: 'view',
                    view_id: 'test-view-id',
                },
            };
            await slack.messageClient.sendAction(payload);
            const mockedChatUpdate = jest.mocked(slack.webClient.chat.update);
            const mockedViewsUpdate = jest.mocked(slack.webClient.views.update);
            const state = MockedState.mocks.get('twenty-questions');
            const player = state.currentGame.players[slack.fakeUser];
            expect(player.questionCount).toBe(1);
            expect(player.questions).toHaveLength(1);
            expect(player.questions[0].question).toBe('それは生き物ですか？');
            expect(player.questions[0].answer).toBe('はい');
            expect(mockedIncrement).toBeCalledWith(slack.fakeUser, 'twenty-questions-ask-question');
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
