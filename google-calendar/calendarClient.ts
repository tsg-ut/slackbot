import {readFileSync} from 'fs';
import {google, calendar_v3} from 'googleapis';
import dayjs from '../lib/dayjs';
import type {CalendarEvent} from './types';

let calendarInstance: calendar_v3.Calendar | null = null;

const getCalendar = (): calendar_v3.Calendar => {
	if (calendarInstance === null) {
		const auth = new google.auth.GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
		});
		calendarInstance = google.calendar({version: 'v3', auth});
	}
	return calendarInstance;
};

export const getServiceAccountEmail = (): string => {
	const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	if (!credPath) {
		return '';
	}
	try {
		const creds = JSON.parse(readFileSync(credPath, 'utf8')) as {client_email?: string};
		return creds.client_email ?? '';
	} catch {
		return '';
	}
};

export interface CalendarInfo {
	summary: string;
}

export const getCalendarInfo = async (calendarId: string): Promise<CalendarInfo> => {
	const response = await getCalendar().calendars.get({calendarId});
	return {summary: response.data.summary ?? calendarId};
};

export interface SyncResult {
	events: CalendarEvent[];
	nextSyncToken: string;
}

export const syncCalendarEvents = async (
	calendarId: string,
	syncToken: string | null,
): Promise<SyncResult> => {
	const calendar = getCalendar();
	const allEvents: CalendarEvent[] = [];
	let nextPageToken: string | undefined = undefined;
	let nextSyncToken = '';

	const baseParams: calendar_v3.Params$Resource$Events$List = {
		calendarId,
		showDeleted: true,
		singleEvents: true,
		...(syncToken
			? {syncToken}
			: {timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}),
	};

	do {
		const response = await calendar.events.list({
			...baseParams,
			...(nextPageToken ? {pageToken: nextPageToken} : {}),
		});
		allEvents.push(...(response.data.items ?? []));
		nextPageToken = response.data.nextPageToken ?? undefined;
		if (response.data.nextSyncToken) {
			nextSyncToken = response.data.nextSyncToken;
		}
	} while (nextPageToken);

	return {events: allEvents, nextSyncToken};
};

export const listUpcomingEvents = async (
	calendarId: string,
	timeMin: Date,
	timeMax: Date,
): Promise<CalendarEvent[]> => {
	const calendar = getCalendar();
	const allEvents: CalendarEvent[] = [];
	let nextPageToken: string | undefined = undefined;

	do {
		const response = await calendar.events.list({
			calendarId,
			timeMin: timeMin.toISOString(),
			timeMax: timeMax.toISOString(),
			singleEvents: true,
			orderBy: 'startTime',
			...(nextPageToken ? {pageToken: nextPageToken} : {}),
		});
		allEvents.push(...(response.data.items ?? []));
		nextPageToken = response.data.nextPageToken ?? undefined;
	} while (nextPageToken);

	// Exclude events matching all of the following conditions:
	// - starts at 0:00 and ends at 0:00
	// - starts after 24 hours before timeMax
	const filteredEvents = allEvents.filter((event) => {
		// Events with dateTime
		if (event.start?.dateTime && event.end?.dateTime) {
			const startDateTime = dayjs(event.start.dateTime).tz('Asia/Tokyo');
			const endDateTime = dayjs(event.end.dateTime).tz('Asia/Tokyo');
			if (
				startDateTime.hour() === 0 &&
				startDateTime.minute() === 0 &&
				endDateTime.hour() === 0 &&
				endDateTime.minute() === 0 &&
				startDateTime.isAfter(timeMax.getTime() - 24 * 60 * 60 * 1000)
			) {
				return false;
			}
		}

		// All-day events
		if (event.start?.date && event.end?.date && !event.start.dateTime && !event.end.dateTime) {
			const startDate = dayjs(event.start.date).tz('Asia/Tokyo');
			if (
				startDate.isAfter(timeMax.getTime() - 24 * 60 * 60 * 1000)
			) {
				return false;
			}
		}
		return true;
	});

	return filteredEvents;
};
