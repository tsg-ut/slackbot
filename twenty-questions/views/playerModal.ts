import type {KnownBlock, View} from '@slack/web-api';
import type {PlayerState, StateObj} from '../TwentyQuestions';

export default (state: StateObj, player: PlayerState): View => {
	const questionsText =
		player.questions.length === 0
			? 'まだ質問をしていません。'
			: player.questions
				.map((q, i) => {
					if (q.isAnswerAttempt) {
						const emoji = q.isCorrect ? ':white_check_mark:' : ':x:';
						return `${emoji} ${q.question}\n${q.answer}`;
					}
					return `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.answer}`;
				})
				.join('\n\n');

	const blocks: KnownBlock[] = [
		{
			type: 'header' as const,
			text: {
				type: 'plain_text' as const,
				text: 'これまでの質問と回答',
				emoji: true,
			},
		},
		{
			type: 'section' as const,
			text: {
				type: 'mrkdwn' as const,
				text: questionsText,
			},
		},
		{
			type: 'divider' as const,
		},
		{
			type: 'section' as const,
			text: {
				type: 'mrkdwn' as const,
				text: `質問回数: ${player.questionCount} / 20`,
			},
		},
	];

	if (player.isFinished) {
		blocks.push({
			type: 'section' as const,
			text: {
				type: 'mrkdwn' as const,
				text: player.score !== null
					? `🎉 ＊正解済み！＊ (${player.score}問で正解)`
					: '❌ ＊ゲーム終了＊ (20問使い切りました)',
			},
		});

		return {
			type: 'modal',
			callback_id: `twenty_questions_${state.uuid}_player_modal`,
			title: {
				text: '20の扉',
				type: 'plain_text',
			},
			notify_on_close: true,
			blocks,
		};
	}

	// 質問回数が19回以下の場合は質問セクションを表示
	if (player.questionCount < 19) {
		blocks.push(
			{
				type: 'input' as const,
				block_id: 'question_input',
				optional: true,
				element: {
					type: 'plain_text_input' as const,
					action_id: 'question_input_field',
					max_length: 30,
					placeholder: {
						type: 'plain_text' as const,
						text: '「はい」「いいえ」で答えられる質問を入力',
					},
				},
				label: {
					type: 'plain_text' as const,
					text: '質問する (最大30文字)',
				},
			},
			{
				type: 'actions' as const,
				block_id: 'question_actions',
				elements: [
					{
						type: 'button' as const,
						text: {
							type: 'plain_text' as const,
							text: '質問を送信',
							emoji: true,
						},
						action_id: `twenty_questions_${state.uuid}_submit_question`,
						style: 'primary' as const,
					},
				],
			},
			{
				type: 'divider' as const,
			},
		);
	}

	// 答えセクションは常に表示
	blocks.push(
		{
			type: 'input' as const,
			block_id: 'answer_input',
			optional: true,
			element: {
				type: 'plain_text_input' as const,
				action_id: 'answer_input_field',
				max_length: 15,
				placeholder: {
					type: 'plain_text' as const,
					text: 'お題だと思う単語を入力',
				},
			},
			label: {
				type: 'plain_text' as const,
				text: '答えを当てる (最大15文字)',
			},
		},
		{
			type: 'actions' as const,
			block_id: 'answer_actions',
			elements: [
				{
					type: 'button' as const,
					text: {
						type: 'plain_text' as const,
						text: '答えを送信',
						emoji: true,
					},
					action_id: `twenty_questions_${state.uuid}_submit_answer`,
					style: 'danger' as const,
				},
			],
		},
	);

	// inputブロックがあるため、submitは常に必要
	const submitText = player.questionCount < 19 ? '質問を送信' : '答えを送信';

	return {
		type: 'modal',
		callback_id: `twenty_questions_${state.uuid}_player_modal`,
		title: {
			text: '20の扉',
			type: 'plain_text',
		},
		submit: {
			text: submitText,
			type: 'plain_text',
		},
		notify_on_close: true,
		blocks,
	};
};
