"use strict";
/* eslint-env jest */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const gameLogModal_1 = __importDefault(require("./gameLogModal"));
const firebase_admin_1 = require("firebase-admin");
const expectEquals = (actual, expected) => {
    expect(actual).toBe(expected);
};
describe('gameLogModal', () => {
    it('shows topic in header', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const header = blocks.find((block) => block.type === 'header');
        expectEquals(header?.type, 'header');
        expect(header.text.text).toBe('お題: りんご');
        // データシートセクションを確認
        const dataSheetSection = blocks.find((block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('【データシート】'));
        expect(dataSheetSection).toBeDefined();
        expectEquals(dataSheetSection?.type, 'section');
        expect(dataSheetSection.text.text).toContain('テスト説明');
    });
    it('shows message when no players', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const section = blocks.find((block) => block.type === 'section' && 'text' in block && block.text?.text === '参加者がいません。');
        expect(section).toBeDefined();
    });
    it('displays correct players in order', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [
                {
                    userId: 'U123',
                    questions: [],
                    questionCount: 10,
                    score: 10,
                },
                {
                    userId: 'U456',
                    questions: [],
                    questionCount: 5,
                    score: 5,
                },
                {
                    userId: 'U789',
                    questions: [],
                    questionCount: 15,
                    score: null,
                },
            ],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const sections = blocks.filter((block) => block.type === 'section');
        // 正解者が先、その中でスコア順
        // U456 (5問) -> U123 (10問) -> U789 (失敗)
        const userMentions = sections
            .map((block) => 'text' in block ? block.text?.text : undefined)
            .filter((text) => text?.includes('<@U'))
            .join('\n');
        expect(userMentions?.indexOf('<@U456>')).toBeLessThan(userMentions?.indexOf('<@U123>'));
        expect(userMentions?.indexOf('<@U123>')).toBeLessThan(userMentions?.indexOf('<@U789>'));
    });
    it('shows player status correctly', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [
                {
                    userId: 'U123',
                    questions: [],
                    questionCount: 5,
                    score: 5,
                },
                {
                    userId: 'U456',
                    questions: [],
                    questionCount: 20,
                    score: null,
                },
            ],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const sections = blocks
            .filter((block) => block.type === 'section')
            .map((block) => 'text' in block ? block.text?.text : undefined)
            .join('\n');
        expect(sections).toContain('5問で正解');
        expect(sections).toContain('不正解');
    });
    it('displays question history for player', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [
                {
                    userId: 'U123',
                    questions: [
                        {
                            question: '食べ物ですか？',
                            answer: 'はい',
                            timestamp: Date.now(),
                            isAnswerAttempt: false,
                        },
                        {
                            question: '果物ですか？',
                            answer: 'はい',
                            timestamp: Date.now(),
                            isAnswerAttempt: false,
                        },
                    ],
                    questionCount: 2,
                    score: null,
                },
            ],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const sections = blocks
            .filter((block) => block.type === 'section')
            .map((block) => 'text' in block ? block.text?.text : undefined)
            .join('\n');
        expect(sections).toContain('Q1: 食べ物ですか？');
        expect(sections).toContain('A1: はい');
        expect(sections).toContain('Q2: 果物ですか？');
        expect(sections).toContain('A2: はい');
    });
    it('shows answer attempts with correct formatting', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [
                {
                    userId: 'U123',
                    questions: [
                        {
                            question: '食べ物ですか？',
                            answer: 'はい',
                            timestamp: Date.now(),
                            isAnswerAttempt: false,
                        },
                        {
                            question: 'みかん',
                            answer: '不正解です',
                            timestamp: Date.now(),
                            isAnswerAttempt: true,
                        },
                    ],
                    questionCount: 2,
                    score: null,
                },
            ],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const sections = blocks
            .filter((block) => block.type === 'section')
            .map((block) => 'text' in block ? block.text?.text : undefined)
            .join('\n');
        expect(sections).toContain(':x: みかん');
        expect(sections).toContain('不正解です');
    });
    it('shows empty message when player has no questions', () => {
        const game = {
            id: 'game-1',
            topic: 'りんご',
            topicRuby: 'りんご',
            topicDescription: 'テスト説明',
            startedAt: firebase_admin_1.firestore.Timestamp.now(),
            finishedAt: firebase_admin_1.firestore.Timestamp.now(),
            statusMessageTs: null,
            players: [
                {
                    userId: 'U123',
                    questions: [],
                    questionCount: 1,
                    score: null,
                },
            ],
        };
        const view = (0, gameLogModal_1.default)(game);
        const blocks = view.blocks;
        const sections = blocks
            .filter((block) => block.type === 'section')
            .map((block) => 'text' in block ? block.text?.text : undefined)
            .join('\n');
        expect(sections).toContain('_質問履歴なし_');
    });
});
