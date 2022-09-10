import {View} from '@slack/web-api';
import type {Game} from '../index';

export default (game: Game, questionText: string) => ({
	type: 'modal',
	callback_id: 'slowquiz_answer_question_dialog',
	title: {
		text: 'クイズ回答',
		type: 'plain_text',
	},
	submit: {
		text: '回答する',
		type: 'plain_text',
	},
	notify_on_close: true,
	private_metadata: game.id,
	blocks: [
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
				text: '回答 (読みがなで入力)',
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
} as View);
