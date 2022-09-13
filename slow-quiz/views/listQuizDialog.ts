import {View} from '@slack/web-api';
import {stripIndent} from 'common-tags';
import type {Game} from '../index';

export default (games: Game[]) => ({
	type: 'modal',
	callback_id: 'slowquiz_answer_question_dialog',
	title: {
		text: 'あなたが登録した問題一覧',
		type: 'plain_text',
	},
	notify_on_close: true,
	blocks:
		games.map((game) => ({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: stripIndent`
					問題: ${game.question}
					回答: ${game.answer}
					読み: ${game.ruby}
					ヒント: ${game.hint ?? ''}
				`,
			},
			accessory: {
				type: 'button',
				text: {
					type: 'plain_text',
					text: '削除する',
					emoji: true,
				},
				style: 'danger',
				value: game.id,
				action_id: 'slowquiz_delete_quiz_button',
			},
		})),
} as View);
