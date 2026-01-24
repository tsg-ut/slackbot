import type {KnownBlock, View} from '@slack/web-api';
import type {PlayerState, StateObj} from '../TwentyQuestions';
import {MAX_QUESTION_LENGTH, MAX_ANSWER_LENGTH} from '../const';

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
			type: 'header',
			text: {
				type: 'plain_text',
				text: 'これまでの質問と回答',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: questionsText,
			},
		},
		{
			type: 'divider',
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `質問回数: ${player.questionCount} / 20`,
			},
		},
	];

	if (player.isFinished) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: player.score !== null
					? `🎉 ＊正解済み！＊ (${player.score}問で正解)`
					: '❌ ＊ゲーム終了＊ (20問使い切りました)',
			},
		});

		if (state.currentGame) {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `正解: ＊${state.currentGame.topic}＊`,
				},
			});
		}

		return {
			type: 'modal',
			callback_id: 'twenty_questions_player_modal',
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
				type: 'input',
				block_id: 'question_input',
				optional: true,
				element: {
					type: 'plain_text_input',
					action_id: 'question_input_field',
					max_length: MAX_QUESTION_LENGTH,
					placeholder: {
						type: 'plain_text',
						text: '「はい」「いいえ」で答えられる質問を入力',
					},
					initial_value: '',
				},
				label: {
					type: 'plain_text',
					text: `質問する (最大${MAX_QUESTION_LENGTH}文字)`,
				},
			},
			{
				type: 'actions',
				block_id: 'question_actions',
				elements: [
					{
						type: 'button',
						text: {
							type: 'plain_text',
							text: '質問を送信',
							emoji: true,
						},
						action_id: 'twenty_questions_submit_question',
						style: 'primary',
					},
				],
			},
			{
				type: 'divider',
			},
		);
	}

	// 答えセクションは進行中のみ表示
	blocks.push(
		{
			type: 'input',
			block_id: 'answer_input',
			optional: true,
			element: {
				type: 'plain_text_input',
				action_id: 'answer_input_field',
				max_length: MAX_ANSWER_LENGTH,
				placeholder: {
					type: 'plain_text',
					text: 'お題だと思う単語を入力',
				},
				initial_value: '',
			},
			label: {
				type: 'plain_text',
				text: `答えを当てる (最大${MAX_ANSWER_LENGTH}文字)`,
			},
		},
		{
			type: 'actions',
			block_id: 'answer_actions',
			elements: [
				{
					type: 'button',
					text: {
						type: 'plain_text',
						text: '答えを送信',
						emoji: true,
					},
					action_id: 'twenty_questions_submit_answer',
					style: 'danger',
				},
			],
		},
	);

	// inputブロックがあるため、submitは常に必要
	const submitText = player.questionCount < 19 ? '質問を送信' : '答えを送信';

	return {
		type: 'modal',
		callback_id: 'twenty_questions_player_modal',
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
