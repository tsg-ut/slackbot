import {View} from '@slack/web-api';

export default {
	type: 'modal',
	callback_id: 'sunrise_register_point_dialog',
	title: {
		text: '地点登録',
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
				text: '緯度',
			},
			element: {
				type: 'number_input',
				is_decimal_allowed: true,
				action_id: 'latitude',
				min_value: '-90',
				max_value: '90',
				focus_on_load: true,
				placeholder: {
					type: 'plain_text',
					text: '35.659',
				},
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '経度',
			},
			element: {
				type: 'number_input',
				is_decimal_allowed: true,
				action_id: 'longitude',
				min_value: '-180',
				max_value: '180',
				placeholder: {
					type: 'plain_text',
					text: '139.685',
				},
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '地点名',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'name',
				placeholder: {
					type: 'plain_text',
					text: '駒場',
				},
			},
		},
	],
} as View;

