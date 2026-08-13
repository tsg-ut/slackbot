import {readFileSync} from 'fs';
import {google, calendar_v3} from 'googleapis';
import dayjs from '../lib/dayjs.js';
import type {CalendarEvent} from './types.js';

const TIMEZONE = 'Asia/Tokyo';

const sanitizeHtml = (html: string): string => (
	html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, '\'')
		.replace(/&#\d+;/g, (match) => String.fromCharCode(parseInt(match.slice(2, -1))))
);

const normalizeEvent = (event: CalendarEvent): CalendarEvent => {
	if (!event.description) {
		return event;
	}
	return {...event, description: sanitizeHtml(event.description)};
};

let calendarInstance: calendar_v3.Calendar | null = null;

const getCalendar = (): calendar_v3.Calendar => {
	if (calendarInstance === null) {
		const auth = new google.auth.GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/calendar.events'],
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

export const getCalendarEvent = async (calendarId: string, eventId: string): Promise<CalendarEvent> => {
	const response = await getCalendar().events.get({calendarId, eventId});
	return normalizeEvent(response.data);
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
		allEvents.push(...(response.data.items ?? []).map(normalizeEvent));
		nextPageToken = response.data.nextPageToken ?? undefined;
		if (response.data.nextSyncToken) {
			nextSyncToken = response.data.nextSyncToken;
		}
	} while (nextPageToken);

	return {events: allEvents, nextSyncToken};
};

export const updateCalendarEventLocation = async (
	calendarId: string,
	eventId: string,
	location: string,
): Promise<void> => {
	await getCalendar().events.patch({calendarId, eventId, requestBody: {location}});
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
		allEvents.push(...(response.data.items ?? []).map(normalizeEvent));
		nextPageToken = response.data.nextPageToken ?? undefined;
	} while (nextPageToken);

	// Exclude events matching all of the following conditions:
	// - starts at 0:00 and ends at 0:00
	// - starts after 24 hours before timeMax
	const filteredEvents = allEvents.filter((event) => {
		// Events with dateTime
		if (event.start?.dateTime && event.end?.dateTime) {
			const startDateTime = dayjs(event.start.dateTime).tz(TIMEZONE);
			const endDateTime = dayjs(event.end.dateTime).tz(TIMEZONE);
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
			const startDate = dayjs(event.start.date).tz(TIMEZONE);
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
