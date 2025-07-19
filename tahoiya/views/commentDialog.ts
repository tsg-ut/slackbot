import type {View} from '@slack/web-api';

export default (gameId: string): View => ({
	type: 'modal',
	callback_id: `tahoiya_comment_${gameId}`,
	title: {
		text: 'たほいや - コメント',
		type: 'plain_text',
	},
	submit: {
		text: '送信',
		type: 'plain_text',
	},
	close: {
		text: 'キャンセル',
		type: 'plain_text',
	},
	private_metadata: gameId,
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'ゲームにコメントを追加してください',
			},
		},
		{
			type: 'input',
			block_id: 'comment_input',
			element: {
				type: 'plain_text_input',
				action_id: 'comment_text',
				placeholder: {
					type: 'plain_text',
					text: 'コメントを入力してください...',
				},
				multiline: true,
			},
			label: {
				type: 'plain_text',
				text: 'コメント',
			},
		},
	],
});