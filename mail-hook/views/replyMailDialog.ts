import {View} from '@slack/web-api';
import {stripIndent} from 'common-tags';
import type {Mail} from '..';

export default (mail: Mail) => ({
	type: 'modal',
	callback_id: 'mail_hook_reply_mail_dialog',
	title: {
		text: 'メール返信',
		type: 'plain_text',
	},
	submit: {
		text: 'メールを送信する (取消不可)',
		type: 'plain_text',
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'plain_text',
				text: mail.body.text,
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '返信',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'body',
				multiline: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: stripIndent`
					FROM: \`${process.env.MAIL_HOOK_REPLY_FROM}\`
					REPLY-TO: \`${process.env.MAIL_HOOK_REPLY_FROM}\`
					TO: \`${mail.addresses.from}\`
					CC: \`${mail.addresses.cc}\`
					SUBJECT: \`Re: ${mail.subject}\`
				`,
			},
		},
	],
	private_metadata: JSON.stringify({mailId: mail.id}),
} as View);
