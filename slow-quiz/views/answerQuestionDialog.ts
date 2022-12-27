import {View} from '@slack/web-api';
import type {Game} from '../index';

export default (game: Game, questionText: string, user: string) => {
	const userAnswers = game.wrongAnswers.filter((answer) => answer.user === user);

	return {
		type: 'modal',
		callback_id: 'slowquiz_answer_question_dialog',
		title: {
			text: 'クイズ解答',
			type: 'plain_text',
		},
		submit: {
			text: '解答する',
			type: 'plain_text',
		},
		notify_on_close: true,
		private_metadata: game.id,
		blocks: [
			{
				type: 'header',
				text: {
					type: 'plain_text',
					text: 'あなたのこれまでの解答',
					emoji: true,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: userAnswers.length === 0
						? 'まだ解答がありません'
						: userAnswers.map((answer) => (
							`${answer.days}日目: 「${answer.answer}」`
						)).join('\n'),
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `＊Q. ${questionText}＊`,
				},
			},
			{
				type: 'input',
				label: {
					type: 'plain_text',
					text: '解答 (読みがなで入力)',
				},
				element: {
					type: 'plain_text_input',
					action_id: 'ruby',
				},
				...(game.hint ? {
					hint: {
						type: 'plain_text',
						text: game.hint,
					},
				} : {}),
			},
		],
	} as View;
};
