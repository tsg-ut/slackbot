/* eslint-env jest */

import gameStatusMessage from './gameStatusMessage';
import type {StateObj} from '../TwentyQuestions';
import type {KnownBlock, ActionsBlock} from '@slack/web-api';

const expectEquals: <S, T extends S>(actual: S, expected: T) => asserts actual is T = <S, T extends S>(actual: S, expected: T) => {
	expect(actual).toBe(expected);
};

describe('gameStatusMessage', () => {
	it('shows message when no game exists', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: null,
		};

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const header = blocks.find((block) => block.type === 'header');
		expectEquals(header?.type, 'header');
		expect(header.text.text).toBe('20の扉');

		const section = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('現在進行中のゲームはありません'),
		);
		expect(section).toBeDefined();
	});

	it('shows active game status', () => {
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

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const statusSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('現在の状態'),
		);
		expectEquals(statusSection?.type, 'section');
		expect(statusSection.text.text).toContain('参加受付中');
	});

	it('shows finished game status with topic', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'finished',
				startedAt: Date.now(),
				finishedAt: Date.now(),
				players: {},
				statusMessageTs: '1234567890.123456',
			},
		};

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const statusSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('現在の状態'),
		);
		expectEquals(statusSection?.type, 'section');
		expect(statusSection.text.text).toContain('終了');

		const topicSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('＊正解:＊'),
		);
		expectEquals(topicSection?.type, 'section');
		expect(topicSection.text.text).toContain('りんご');
	});

	it('shows join button when game is active', () => {
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

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const actionsBlock = blocks.find((block): block is ActionsBlock => block.type === 'actions');
		expect(actionsBlock).toBeDefined();

		const joinButton = actionsBlock?.elements?.find(
			(element) => 'text' in element && element.text?.text === '参加する',
		);
		expect(joinButton).toBeDefined();
		expectEquals(joinButton.type, 'button');
		expect(joinButton.action_id).toBe('twenty_questions_test-uuid_join_button');
	});

	it('shows view log button when game is finished', () => {
		const state: StateObj = {
			uuid: 'test-uuid',
			currentGame: {
				id: 'game-1',
				topic: 'りんご',
				status: 'finished',
				startedAt: Date.now(),
				finishedAt: Date.now(),
				players: {},
				statusMessageTs: '1234567890.123456',
			},
		};

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const actionsBlock = blocks.find((block): block is ActionsBlock => block.type === 'actions');
		expect(actionsBlock).toBeDefined();

		const viewLogButton = actionsBlock?.elements?.find(
			(element) => 'text' in element && element.text?.text === 'ログを確認する',
		);
		expect(viewLogButton).toBeDefined();
		expectEquals(viewLogButton.type, 'button');
		expect(viewLogButton.action_id).toBe('twenty_questions_test-uuid_view_log_button');
	});

	it('shows ranking with correct players', () => {
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
						score: 15,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const rankingSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('ランキング'),
		);
		expectEquals(rankingSection?.type, 'section');

		expect(rankingSection.text.text).toContain('1位: <@U456> (5問)');
		expect(rankingSection.text.text).toContain('2位: <@U123> (10問)');
		expect(rankingSection.text.text).toContain('3位: <@U789> (15問)');
	});

	it('shows failed players separately', () => {
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
						questionCount: 15,
						isFinished: true,
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const rankingSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('ランキング'),
		);
		expectEquals(rankingSection?.type, 'section');

		expect(rankingSection.text.text).toContain('1位: <@U123> (5問)');
		expect(rankingSection.text.text).toContain('＊未正解:＊');
		expect(rankingSection.text.text).toContain('<@U456>');
		expect(rankingSection.text.text).toContain('<@U789>');
	});

	it('shows message when no participants', () => {
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

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const rankingSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('ランキング'),
		);
		expectEquals(rankingSection?.type, 'section');

		expect(rankingSection.text.text).toContain('まだ参加者はいません');
	});

	it('shows message when no correct answers yet', () => {
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
						score: null,
					},
				},
				statusMessageTs: '1234567890.123456',
			},
		};

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const rankingSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('ランキング'),
		);
		expectEquals(rankingSection?.type, 'section');

		expect(rankingSection.text.text).toContain('まだ正解者はいません');
		expect(rankingSection.text.text).toContain('<@U123>');
	});

	it('includes game rules', () => {
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

		const blocks = gameStatusMessage(state) as KnownBlock[];

		const rulesSection = blocks.find(
			(block) => block.type === 'section' && 'text' in block && block.text?.text?.includes('ルール'),
		);
		expectEquals(rulesSection?.type, 'section');

		expect(rulesSection.text.text).toContain('AIが選んだお題の単語を当てるゲーム');
		expect(rulesSection.text.text).toContain('最大20回');
		expect(rulesSection.text.text).toContain('30分で自動終了');
	});
});
