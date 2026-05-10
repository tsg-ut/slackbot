import type {View, KnownBlock} from '@slack/web-api';
import type {Subscription} from '../types';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

const calendarUrl = (calendarId: string): string => `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}`;

const formatNotificationSummary = (sub: Subscription): string => {
	const items: string[] = [];
	if (sub.onAddDelete) {
		items.push('追加/削除通知');
	}
	if (sub.onStart) {
		items.push('開始通知');
	}
	if (sub.minutesBefore !== null) {
		items.push(`${sub.minutesBefore}分前通知`);
	}
	if (sub.dailyHour !== null) {
		items.push(`毎日${sub.dailyHour}時サマリー`);
	}
	if (sub.weeklyDay !== null && sub.weeklyHour !== null) {
		items.push(`毎週${DAY_NAMES[sub.weeklyDay]}曜日${sub.weeklyHour}時サマリー`);
	}
	return items.length > 0 ? items.join(' / ') : '(通知なし)';
};

export default (subscriptions: Subscription[], channelId: string): View => {
	const blocks: KnownBlock[] = [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'このチャンネルの Google Calendar 通知設定です。',
			},
		},
	];

	if (subscriptions.length === 0) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: '_通知がまだ設定されていません。_',
			},
		});
	} else {
		for (const sub of subscriptions) {
			blocks.push({type: 'divider'});
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `*<${calendarUrl(sub.calendarId)}|${sub.calendarName}>*\n\`${sub.calendarId}\`\n*通知設定:* ${formatNotificationSummary(sub)}`,
				},
				accessory: {
					type: 'button',
					text: {type: 'plain_text', text: '削除'},
					style: 'danger',
					action_id: 'gcal_delete_subscription',
					value: sub.id,
					confirm: {
						title: {type: 'plain_text', text: '削除の確認'},
						text: {
							type: 'mrkdwn',
							text: `カレンダー *${sub.calendarName}* の通知を削除しますか？`,
						},
						confirm: {type: 'plain_text', text: '削除'},
						deny: {type: 'plain_text', text: 'キャンセル'},
					},
				},
			});
		}
	}

	blocks.push({type: 'divider'});
	blocks.push({
		type: 'actions',
		elements: [
			{
				type: 'button',
				text: {type: 'plain_text', text: '+ 通知を追加', emoji: true},
				style: 'primary',
				action_id: 'gcal_show_add_subscription',
			},
		],
	});

	return {
		type: 'modal',
		callback_id: 'gcal_settings',
		title: {type: 'plain_text', text: 'Calendarの設定'},
		close: {type: 'plain_text', text: '閉じる'},
		private_metadata: JSON.stringify({channelId}),
		blocks,
	};
};
