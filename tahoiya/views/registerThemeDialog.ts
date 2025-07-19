import type {View} from '@slack/web-api';

export default (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_register_theme',
	title: {
		text: 'デイリーたほいや - お題登録',
		type: 'plain_text',
	},
	submit: {
		text: '登録',
		type: 'plain_text',
	},
	close: {
		text: 'キャンセル',
		type: 'plain_text',
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'デイリーたほいやのお題を登録してください。',
			},
		},
		{
			type: 'input',
			block_id: 'word_input',
			element: {
				type: 'plain_text_input',
				action_id: 'word_text',
				placeholder: {
					type: 'plain_text',
					text: '例: 猫',
				},
			},
			label: {
				type: 'plain_text',
				text: '単語',
			},
		},
		{
			type: 'input',
			block_id: 'ruby_input',
			element: {
				type: 'plain_text_input',
				action_id: 'ruby_text',
				placeholder: {
					type: 'plain_text',
					text: '例: ねこ',
				},
			},
			label: {
				type: 'plain_text',
				text: '読み仮名（ひらがな）',
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
					text: '例: 小型の肉食哺乳動物',
				},
				max_length: 256,
				multiline: true,
			},
			label: {
				type: 'plain_text',
				text: '意味',
			},
		},
		{
			type: 'input',
			block_id: 'source_input',
			element: {
				type: 'plain_text_input',
				action_id: 'source_text',
				placeholder: {
					type: 'plain_text',
					text: '例: Wikipedia',
				},
			},
			label: {
				type: 'plain_text',
				text: 'ソース',
			},
		},
		{
			type: 'input',
			block_id: 'url_input',
			element: {
				type: 'url_text_input',
				action_id: 'url_text',
				placeholder: {
					type: 'plain_text',
					text: 'https://example.com',
				},
			},
			label: {
				type: 'plain_text',
				text: 'URL',
			},
		},
	],
});