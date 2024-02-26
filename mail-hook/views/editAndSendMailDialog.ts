import {View} from '@slack/web-api';
import type {Mail} from '../index';

export default (mailId: string, content: string) => ({
	type: 'modal',
	callback_id: 'mail_hook_edit_and_send_mail_dialog',
	title: {
		text: 'メール編集',
		type: 'plain_text',
	},
	submit: {
		text: 'メールを送信する (取消不可)',
		type: 'plain_text',
	},
	blocks: [
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '返信',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'body',
				initial_value: content,
				multiline: true,
			},
		},
	],
} as View);

