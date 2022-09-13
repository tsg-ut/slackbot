import {View} from '@slack/web-api';
import type {Game, AnswerInfo} from '../index';

export default (game: Game, answerInfos: AnswerInfo[]) => ({
	type: 'modal',
	callback_id: 'slowquiz_answer_question_dialog',
	title: {
		text: 'これまでの回答一覧',
		type: 'plain_text',
	},
	notify_on_close: true,
	private_metadata: game.id,
	blocks: [
		{
			type: 'context',
			elements: [
				{
					type: 'plain_text',
					text: '出題者にだけ表示されています',
				},
			],
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `＊Q. ${game.question}＊`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: answerInfos.map((info) => (
					`${info.progress}日目: <@${info.user}> 「${info.answer}」`
				)).join('\n'),
			},
		},
	],
} as View);
