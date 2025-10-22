/* eslint-env jest */

import gameLogModal from './gameLogModal';
import type {StateObj} from '../TwentyQuestions';
import type {KnownBlock} from '@slack/web-api';

const expectEquals: <S, T extends S>(actual: S, expected: T) => asserts actual is T = <S, T extends S>(actual: S, expected: T) => {
	expect(actual).toBe(expected);
};

describe('gameLogModal', () => {
	it('shows message when no game exists', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: null,
		};

		const view = gameLogModal(state);

		expectEquals(view.type, 'modal');
		expect(view.title?.text).toBe('ゲームログ');

		const blocks = view.blocks as KnownBlock[];
		const section = blocks.find((block) => block.type === 'section');
		expectEquals(section?.type, 'section');
		expect(section.text.text).toBe('ゲームが見つかりません。');
	});

	it('shows topic in header', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
		const header = blocks.find((block) => block.type === 'header');
		expectEquals(header?.type, 'header');
		expect(header.text.text).toBe('お題: りんご');
	});

	it('shows message when no players', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
		const section = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text === '参加者がいません。',
		);
		expect(section).toBeDefined();
	});

	it('displays correct players in order', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'finished',
				startedAt: Date.now(),
				finishedAt: Date.now(),
				players: {
					U123: {
						userId: 'U123',
						questions: [],
						questionCount: 10,
						isFinished: true,
						score: 10,
					},
					U456: {
						userId: 'U456',
						questions: [],
						questionCount: 5,
						isFinished: true,
						score: 5,
					},
					U789: {
						userId: 'U789',
						questions: [],
						questionCount: 15,
						isFinished: true,
						score: null, // 失敗
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
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
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {
					U123: {
						userId: 'U123',
						questions: [],
						questionCount: 5,
						isFinished: true,
						score: 5,
					},
					U456: {
						userId: 'U456',
						questions: [],
						questionCount: 20,
						isFinished: true,
						score: null,
					},
					U789: {
						userId: 'U789',
						questions: [],
						questionCount: 3,
						isFinished: false,
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
		const sections = blocks
			.filter((block) => block.type === 'section')
			.map((block) => 'text' in block ? block.text?.text : undefined)
			.join('\n');

		expect(sections).toContain('5問で正解');
		expect(sections).toContain('20問使い切り');
		expect(sections).toContain('プレイ中');
	});

	it('displays question history for player', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {
					U123: {
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
						isFinished: false,
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
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
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {
					U123: {
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
						isFinished: false,
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
		const sections = blocks
			.filter((block) => block.type === 'section')
			.map((block) => 'text' in block ? block.text?.text : undefined)
			.join('\n');

		expect(sections).toContain(':x: みかん');
		expect(sections).toContain('不正解です');
	});

	it('shows empty message when player has no questions', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'active',
				startedAt: Date.now(),
				finishedAt: null,
				players: {
					U123: {
						userId: 'U123',
						questions: [],
						questionCount: 1,
						isFinished: false,
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const view = gameLogModal(state);

		const blocks = view.blocks as KnownBlock[];
		const sections = blocks
			.filter((block) => block.type === 'section')
			.map((block) => 'text' in block ? block.text?.text : undefined)
			.join('\n');

		expect(sections).toContain('_質問履歴なし_');
	});
});
