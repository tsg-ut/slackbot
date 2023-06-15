import {View} from '@slack/web-api';
import type {Point} from '../index';

export default (points: Point[]) => ({
	type: 'modal',
	callback_id: 'sunrise_list_points_dialog',
	title: {
		text: '登録された地点一覧',
		type: 'plain_text',
	},
	notify_on_close: true,
	blocks: points.map((point) => ({
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: `＊${point.name}＊ (${point.latitude}, ${point.longitude})`,
		},
		accessory: {
			type: 'button',
			text: {
				type: 'plain_text',
				text: '削除する',
				emoji: true,
			},
			style: 'danger',
			value: point.name,
			action_id: 'sunrise_delete_point_button',
		},
	})),
} as View);

