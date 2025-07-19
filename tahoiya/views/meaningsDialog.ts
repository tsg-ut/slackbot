import type {View} from '@slack/web-api';

export default (gameId: string, themeRuby: string): View => ({
	type: 'modal',
	callback_id: `tahoiya_meanings_${gameId}`,
	title: {
		text: 'たほいや - 意味入力',
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
				text: `*「${themeRuby}」* の意味を考えて入力してください`,
			},
		},
		{
			type: 'input',
			block_id: 'meaning_input',
			element: {
				type: 'plain_text_input',
				action_id: 'meaning_text',
				placeholder: {
					type: 'plain_text',
					text: 'この単語の意味を入力してください...',
				},
				max_length: 256,
				multiline: true,
			},
			label: {
				type: 'plain_text',
				text: '意味',
			},
		},
	],
});