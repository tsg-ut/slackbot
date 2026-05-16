import type {KnownBlock, SectionBlock} from '@slack/bolt';
import dayjs from '../../lib/dayjs';
import type {CalendarEvent} from '../types';

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_SUBTITLE_LENGTH = 150;

const incrementDate = (dateString: string, count: number) => {
	const date = new Date(dateString);
	date.setDate(date.getDate() + count);
	return date.toISOString().slice(0, 10);
};

const formatEventTime = (event: CalendarEvent, includeDate: boolean): string => {
	if (event.start?.dateTime) {
		const startTs = Math.floor(new Date(event.start.dateTime).getTime() / 1000);
		if (event.end?.dateTime) {
			const endTs = Math.floor(new Date(event.end.dateTime).getTime() / 1000);
			return `<!date^${startTs}^${includeDate ? '{date_short_pretty} {time}' : '{time}'}|${event.start.dateTime}> 〜 <!date^${endTs}^{time}|${event.end.dateTime}>`;
		}
		return `<!date^${startTs}^${includeDate ? '{date_short_pretty} {time}' : '{time}'}|${event.start.dateTime}>`;
	}
	if (event.start?.date && event.end?.date) {
		const startDate = dayjs(event.start.date).tz('Asia/Tokyo').format('M月D日');
		const endDate = dayjs(event.end.date).tz('Asia/Tokyo').add(-1, 'day').format('M月D日');
		return `${startDate} 〜 ${endDate}`;
	}
	if (event.start?.date) {
		const startDate = dayjs(event.start.date).tz('Asia/Tokyo').format('M月D日');
		return `${startDate} (終日)`;
	}
	return '(日時未設定)';
};

const buildEventDetailBlocks = (event: CalendarEvent): KnownBlock[] => {
	const blocks: KnownBlock[] = [];

	let placeUrl: string | null = null;
	const isLocationUrl = event.location?.startsWith('http://') || event.location?.startsWith('https://');
	if (isLocationUrl) {
		placeUrl = event.location!;
	} else if (event.location) {
		const encodedLocation = encodeURIComponent(event.location);
		placeUrl = `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`;
	}

	const rawDescription = event.description ?? '';
	const hasMore = rawDescription.length > MAX_DESCRIPTION_LENGTH - 1;
	const description = hasMore ? `${rawDescription.slice(0, MAX_DESCRIPTION_LENGTH - 1)}⋯` : rawDescription;

	let subtitle = formatEventTime(event, true);
	if (event.location) {
		subtitle += ` / ${event.location}`;
	}
	if (subtitle.length > MAX_SUBTITLE_LENGTH - 1) {
		subtitle = `${subtitle.slice(0, MAX_SUBTITLE_LENGTH - 1)}⋯`;
	}

	blocks.push({
		type: 'card',
		title: {
			type: 'mrkdwn',
			text: event.summary ?? '(タイトルなし)',
			verbatim: false,
		},
		subtitle: {
			type: 'mrkdwn',
			text: subtitle,
			verbatim: false,
		},
		...(description && {
			body: {
				type: 'mrkdwn',
				text: description,
				verbatim: false,
			},
		}),
		actions: [
			...(placeUrl ? [
				{
					type: 'button' as const,
					text: {
						type: 'plain_text' as const,
						text: isLocationUrl ? 'リンクを開く' : 'マップで場所を開く',
						emoji: false,
					},
					url: placeUrl,
					style: 'primary' as const,
				},
			] : []),
			...(event.htmlLink ? [
				{
					type: 'button' as const,
					text: {
						type: 'plain_text' as const,
						text: 'カレンダーで開く',
						emoji: false,
					},
					url: event.htmlLink,
				},
			] : []),
		],
	});

	return blocks;
};

export interface EventMessage {
	text: string;
	blocks: KnownBlock[];
}

export const eventAddedMessage = (event: CalendarEvent): EventMessage => ({
	text: `📅 予定が追加されました: ${event.summary ?? '(タイトルなし)'}`,
	blocks: [
		{
			type: 'section',
			text: {type: 'plain_text', text: '📅 予定が追加されました', emoji: true},
		},
		...buildEventDetailBlocks(event),
	],
});

export const eventDeletedMessage = (event: CalendarEvent): EventMessage => ({
	text: `🗑️ 予定が削除されました: ${event.summary ?? '(タイトルなし)'}`,
	blocks: [
		{
			type: 'section',
			text: {type: 'plain_text', text: '🗑️ 予定が削除されました', emoji: true},
		},
		...buildEventDetailBlocks(event),
	],
});

export const eventStartMessage = (event: CalendarEvent): EventMessage => ({
	text: `🔔予定が始まるよ～: ${event.summary ?? '(タイトルなし)'}`,
	blocks: [
		{
			type: 'section',
			text: {type: 'plain_text', text: '🔔予定が始まるよ～', emoji: true},
		},
		...buildEventDetailBlocks(event),
	],
});

export const eventBeforeMessage = (event: CalendarEvent, minutes: number): EventMessage => ({
	text: `⏰ ${minutes}分後に予定が始まるよ～: ${event.summary ?? '(タイトルなし)'}`,
	blocks: [
		{
			type: 'section',
			text: {
				type: 'plain_text',
				text: `⏰ ${minutes}分後に予定が始まるよ～`,
				emoji: true,
			},
		},
		...buildEventDetailBlocks(event),
	],
});

interface SplitEvents {
	shortEvents: CalendarEvent[];
	longEvents: {
		event: CalendarEvent;
		durationInDays: number;
		index: number;
	}[];
}

const splitEvents = (events: CalendarEvent[], now: Date): SplitEvents => {
	const shortEvents: CalendarEvent[] = [];
	const longEvents: {event: CalendarEvent; durationInDays: number; index: number}[] = [];

	for (const event of events) {
		// All-day and one-day event
		if (
			!event.start?.dateTime && !event.end?.dateTime &&
			event.start?.date && event.end?.date &&
			incrementDate(event.start.date, 1) === event.end.date
		) {
			shortEvents.push(event);
			continue;
		}

		// Event that starts after the current time
		if (event.start?.dateTime) {
			const startTime = dayjs(event.start.dateTime);
			if (startTime.isAfter(now)) {
				shortEvents.push(event);
				continue;
			}
		}

		const start = dayjs(event.start?.dateTime ?? event.start?.date);
		const end = dayjs(event.end?.dateTime ?? event.end?.date);
		const durationInDays = end.diff(start, 'day');
		longEvents.push({
			event,
			durationInDays,
			index: -start.diff(now, 'day'),
		});
	}

	shortEvents.sort((a, b) => {
		const aTime = a.start?.dateTime ?? a.start?.date ?? '';
		const bTime = b.start?.dateTime ?? b.start?.date ?? '';
		return aTime.localeCompare(bTime);
	});

	longEvents.sort(({event: a}, {event: b}) => {
		const aTime = a.start?.dateTime ?? a.start?.date ?? '';
		const bTime = b.start?.dateTime ?? b.start?.date ?? '';
		return aTime.localeCompare(bTime);
	});

	return {shortEvents, longEvents};
};

const buildEventListBlocks = (events: SplitEvents, mode: 'daily' | 'weekly'): KnownBlock[] => {
	const sections: SectionBlock[] = [];

	if (events.shortEvents.length > 0) {
		const items: string[] = [
			mode === 'daily' ? '＊本日の予定はこちら！＊' : '＊今週の予定はこちら！＊',
		];

		for (const event of events.shortEvents) {
			const eventTitle = event.htmlLink ? `<${event.htmlLink}|${event.summary ?? '(タイトルなし)'}>` : `${event.summary ?? '(タイトルなし)'}`;
			if (event.start?.dateTime) {
				items.push(`● ${formatEventTime(event, mode === 'weekly')} ＊${eventTitle}＊`);
			} else {
				const startTs = Math.floor(new Date(event.start?.date ?? '').getTime() / 1000);
				const dateString = mode === 'daily' ? '' : `<!date^${startTs}^{date_short_pretty}|${event.start?.date}>`;
				items.push(`● ${dateString}終日 ＊${eventTitle}＊`);
			}
		}

		sections.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: items.join('\n'),
			},
		});
	}

	if (events.longEvents.length > 0) {
		const items: string[] = [
			'＊現在開催中のイベントはこちら！＊',
		];

		for (const {event, index, durationInDays} of events.longEvents) {
			const eventTitle = event.htmlLink ? `<${event.htmlLink}|${event.summary ?? '(タイトルなし)'}>` : `${event.summary ?? '(タイトルなし)'}`;
			let note = '';
			if (mode === 'daily') {
				if (index === 0) {
					note = ' (1日目🏌️)';
				}
				if (index + 1 === durationInDays) {
					note = ' (最終日⛳)';
				}
			}
			items.push(`● ${formatEventTime(event, mode === 'weekly')} ＊${eventTitle}＊${note}`);
		}

		sections.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: items.join('\n'),
			},
		});
	}

	return sections;
};

export const dailySummaryMessage = (events: CalendarEvent[], now: Date): EventMessage => ({
	text: `📅 今日の予定一覧 (${events.length}件)`,
	blocks: [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '☀️TSGのみなさーん、おはようございます！',
				emoji: true,
			},
		},
		...buildEventListBlocks(splitEvents(events, now), 'daily'),
	],
});

export const weeklySummaryMessage = (events: CalendarEvent[], now: Date): EventMessage => ({
	text: `📆 今週の予定一覧 (${events.length}件)`,
	blocks: [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '今週の予定一覧だよ～',
				emoji: true,
			},
		},
		...buildEventListBlocks(splitEvents(events, now), 'weekly'),
	],
});
