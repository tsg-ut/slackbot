import type {calendar_v3} from 'googleapis';

export type CalendarEvent = calendar_v3.Schema$Event;

export interface Subscription {
	id: string;
	channelId: string;
	calendarId: string;
	calendarName: string;
	onAddDelete: boolean;
	onStart: boolean;
	minutesBefore: number | null;
	dailyHour: number | null;
	weeklyDay: number | null;
	weeklyHour: number | null;
}

export interface StateObj {
	subscriptions: Subscription[];
	syncTokens: {[calendarId: string]: string};
	sentNotifications: string[];
	lastDailySummary: {[subscriptionId: string]: string};
	lastWeeklySummary: {[subscriptionId: string]: string};
}
