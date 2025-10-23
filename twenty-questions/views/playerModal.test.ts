/* eslint-env jest */

import playerModal from './playerModal';
import type {StateObj, PlayerState} from '../TwentyQuestions';
import type {InputBlock, SectionBlock} from '@slack/web-api';

const expectEquals: <S, T extends S>(actual: S, expected: T) => asserts actual is T = <S, T extends S>(actual: S, expected: T) => {
	expect(actual).toBe(expected);
};

describe('playerModal', () => {
	const baseState: StateObj = {
		currentGame: {
			id: 'game-1',
			topic: 'テスト',
			topicRuby: 'てすと',
			topicDescription: 'テスト説明',
			status: 'active',
			startedAt: Date.now(),
			finishedAt: null,
			players: {},
			statusMessageTs: '1234567890.123456',
		},
	};

	const basePlayer: PlayerState = {
		userId: 'U123456',
		questions: [],
		questionCount: 0,
		isFinished: false,
		score: null,
	};

	it('shows question input when player has not finished', () => {
		const view = playerModal(baseState, basePlayer);

		expectEquals(view.type, 'modal');
		expect(view.title?.text).toBe('20の扉');
		expect(view.submit?.text).toBe('質問を送信');

		// 質問入力ブロックが存在することを確認
		const questionBlock = view.blocks?.find(
			(block): block is InputBlock => block.type === 'input' && 'block_id' in block && block.block_id === 'question_input',
		);
		expect(questionBlock).toBeDefined();
	});

	it('hides question input when player has 19 questions', () => {
		const player: PlayerState = {
			...basePlayer,
			questionCount: 19,
			questions: Array(19).fill(null).map(() => ({
				question: 'test',
				answer: 'はい',
				timestamp: Date.now(),
				isAnswerAttempt: false,
			})),
		};

		const view = playerModal(baseState, player);

		expectEquals(view.type, 'modal');
		expect(view.submit?.text).toBe('答えを送信');

		// 質問入力ブロックが存在しないことを確認
		const questionBlock = view.blocks?.find(
			(block): block is InputBlock => block.type === 'input' && 'block_id' in block && block.block_id === 'question_input',
		);
		expect(questionBlock).toBeUndefined();
	});

	it('shows answer input when player has questions', () => {
		const player: PlayerState = {
			...basePlayer,
			questionCount: 5,
			questions: Array(5).fill(null).map(() => ({
				question: 'test',
				answer: 'はい',
				timestamp: Date.now(),
				isAnswerAttempt: false,
			})),
		};

		const view = playerModal(baseState, player);

		// 回答入力ブロックが存在することを確認
		const answerBlock = view.blocks?.find(
			(block): block is InputBlock => block.type === 'input' && 'block_id' in block && block.block_id === 'answer_input',
		);
		expect(answerBlock).toBeDefined();
	});

	it('displays question history', () => {
		const player: PlayerState = {
			...basePlayer,
			questionCount: 2,
			questions: [
				{
					question: '食べ物ですか？',
					answer: 'はい',
					timestamp: Date.now(),
					isAnswerAttempt: false,
				},
				{
					question: '果物ですか？',
					answer: 'いいえ',
					timestamp: Date.now(),
					isAnswerAttempt: false,
				},
			],
		};

		const view = playerModal(baseState, player);

		// 質問履歴が表示されていることを確認
		const historyBlock = view.blocks?.find(
			(block): block is SectionBlock => block.type === 'section' && 'text' in block && block.text?.text?.includes('Q1:'),
		);
		expect(historyBlock).toBeDefined();
	});

	it('shows correct submit button text', () => {
		const testCases = [
			{questionCount: 0, expected: '質問を送信'},
			{questionCount: 5, expected: '質問を送信'},
			{questionCount: 10, expected: '質問を送信'},
			{questionCount: 19, expected: '答えを送信'},
		];

		for (const {questionCount, expected} of testCases) {
			const player: PlayerState = {
				...basePlayer,
				questionCount,
				questions: Array(questionCount).fill(null).map(() => ({
					question: 'test',
					answer: 'はい',
					timestamp: Date.now(),
					isAnswerAttempt: false,
				})),
			};

			const view = playerModal(baseState, player);
			expectEquals(view.type, 'modal');
			expect(view.submit?.text).toBe(expected);
		}
	});

	it('displays answer attempts in question history', () => {
		const player: PlayerState = {
			...basePlayer,
			questionCount: 2,
			questions: [
				{
					question: '食べ物ですか？',
					answer: 'はい',
					timestamp: Date.now(),
					isAnswerAttempt: false,
				},
				{
					question: 'りんご',
					answer: '不正解です',
					timestamp: Date.now(),
					isAnswerAttempt: true,
				},
			],
		};

		const view = playerModal(baseState, player);

		// 回答試行が表示されていることを確認
		const historyText = view.blocks
			?.filter((block): block is SectionBlock => block.type === 'section')
			.map((block) => block.text?.text)
			.join('\n');

		expect(historyText).toContain('りんご');
		expect(historyText).toContain('不正解です');
	});
});
