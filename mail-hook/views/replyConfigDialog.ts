import {View} from '@slack/web-api';

interface Config {
	label: string,
	id: string,
	value: string | null,
}

export default (configs: Config[]) => ({
	type: 'modal',
	callback_id: 'mail_hook_reply_config_dialog',
	title: {
		text: 'メール設定',
		type: 'plain_text',
	},
	submit: {
		text: '設定する',
		type: 'plain_text',
	},
	blocks: [
		...configs.map((config) => ({
			type: 'input',
			label: {
				type: 'plain_text',
				text: config.label,
			},
			element: {
				type: 'plain_text_input',
				action_id: config.id,
				...(config.value === null ? {} : {initial_value: config.value}),
			},
		})),
	],
} as View);

