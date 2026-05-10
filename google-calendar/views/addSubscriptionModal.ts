import type {View} from '@slack/web-api';

const DAY_OPTIONS = [
	{text: {type: 'plain_text' as const, text: '日曜日'}, value: '0'},
	{text: {type: 'plain_text' as const, text: '月曜日'}, value: '1'},
	{text: {type: 'plain_text' as const, text: '火曜日'}, value: '2'},
	{text: {type: 'plain_text' as const, text: '水曜日'}, value: '3'},
	{text: {type: 'plain_text' as const, text: '木曜日'}, value: '4'},
	{text: {type: 'plain_text' as const, text: '金曜日'}, value: '5'},
	{text: {type: 'plain_text' as const, text: '土曜日'}, value: '6'},
];

const HOUR_OPTIONS = Array.from({length: 24}, (_, i) => ({
	text: {type: 'plain_text' as const, text: `${i}時`},
	value: i.toString(),
}));

export default (channelId: string): View => ({
	type: 'modal',
	callback_id: 'gcal_add_subscription',
	title: {type: 'plain_text', text: '通知を追加'},
	submit: {type: 'plain_text', text: '追加'},
	close: {type: 'plain_text', text: 'キャンセル'},
	private_metadata: JSON.stringify({channelId}),
	blocks: [
		{
			type: 'input',
			block_id: 'calendar_id_block',
			element: {
				type: 'plain_text_input',
				action_id: 'calendar_id',
				placeholder: {
					type: 'plain_text',
					text: 'xxxxxxxxxx@group.calendar.google.com',
				},
			},
			label: {type: 'plain_text', text: 'カレンダーID'},
			hint: {
				type: 'plain_text',
				text: 'Google CalendarのカレンダーIDを入力してください。カレンダーの設定ページ > 「カレンダーの統合」で確認できます。',
			},
		},
		{
			type: 'input',
			block_id: 'notifications_block',
			optional: true,
			element: {
				type: 'checkboxes',
				action_id: 'notifications',
				options: [
					{
						text: {type: 'mrkdwn', text: '＊イベント追加/更新/削除＊に通知する'},
						value: 'on_add_delete',
					},
					{
						text: {type: 'mrkdwn', text: '＊イベント開始時＊に通知する'},
						value: 'on_start',
					},
				],
			},
			label: {type: 'plain_text', text: '通知のタイプ'},
		},
		{
			type: 'input',
			block_id: 'minutes_before_block',
			optional: true,
			element: {
				type: 'number_input',
				action_id: 'minutes_before',
				is_decimal_allowed: false,
				min_value: '1',
				max_value: '1440',
				placeholder: {type: 'plain_text', text: '例: 30'},
			},
			label: {type: 'plain_text', text: 'N分前通知'},
			hint: {
				type: 'plain_text',
				text: 'イベント開始のN分前に通知を送ります。空白の場合は無効です。',
			},
		},
		{
			type: 'input',
			block_id: 'daily_hour_block',
			optional: true,
			element: {
				type: 'static_select',
				action_id: 'daily_hour',
				placeholder: {type: 'plain_text', text: '時刻を選択...'},
				options: HOUR_OPTIONS,
			},
			label: {type: 'plain_text', text: '毎日のサマリー時刻'},
			hint: {
				type: 'plain_text',
				text: '24時間以内に開始されるイベントと、現在開催中のイベントの一覧を毎日この時刻に投稿します。イベントがない場合は投稿しません。',
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: '*毎週のサマリー*\n7日以内に開始されるイベントの一覧を毎週特定の曜日・時刻に投稿します。イベントがない場合は投稿しません。曜日と時刻は両方設定してください。',
			},
		},
		{
			type: 'input',
			block_id: 'weekly_day_block',
			optional: true,
			element: {
				type: 'static_select',
				action_id: 'weekly_day',
				placeholder: {type: 'plain_text', text: '曜日を選択...'},
				options: DAY_OPTIONS,
			},
			label: {type: 'plain_text', text: '毎週サマリー: 曜日'},
		},
		{
			type: 'input',
			block_id: 'weekly_hour_block',
			optional: true,
			element: {
				type: 'static_select',
				action_id: 'weekly_hour',
				placeholder: {type: 'plain_text', text: '時刻を選択...'},
				options: HOUR_OPTIONS,
			},
			label: {type: 'plain_text', text: '毎週サマリー: 時刻'},
		},
	],
});
