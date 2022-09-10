import {View} from '@slack/web-api';

export default {
	type: 'modal',
	callback_id: 'slowquiz_register_quiz_dialog',
	title: {
		text: 'クイズ登録',
		type: 'plain_text',
	},
	submit: {
		text: '登録する',
		type: 'plain_text',
	},
	notify_on_close: true,
	blocks: [
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '問題',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'question',
				placeholder: {
					type: 'plain_text',
					text: '日本一高い山は何でしょう？',
				},
				multiline: true,
				max_length: 90,
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '答え',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'answer',
				placeholder: {
					type: 'plain_text',
					text: '富士山',
				},
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '読みがな',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'ruby',
				placeholder: {
					type: 'plain_text',
					text: 'ふじさん',
				},
			},
			hint: {
				type: 'plain_text',
				text: '回答に使用します。ひらがな・カタカナ・英数字のみ使用することができます',
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: 'ヒント',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'hint',
				placeholder: {
					type: 'plain_text',
					text: 'かな4文字・最も一般的な名称で回答',
				},
			},
			hint: {
				type: 'plain_text',
				text: '回答が一意に定まるようなヒントを入力してください',
			},
			optional: true,
		},
	],
} as View;
