import {KnownBlock} from '@slack/web-api';
import {google} from 'googleapis';
import dayjs from '../lib/dayjs';
import logger from '../lib/logger';

const log = logger.child({bot: 'calendar'});

const defaultChannel = process.env.CHANNEL_RANDOM;

export default async () => {
	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
	}).getClient();

	const calendar = google.calendar({version: 'v3', auth});

	{
		const result = await calendar.events.list({
			calendarId: process.env.GOOGLE_CALENDAR_ID,
			timeMin: '2023-04-08T00:00:00+0900',
			timeMax: '2023-04-09T00:00:00+0900',
		});
		log.info(result.data);
		const events = result.data.items;

		const boundaryStart = dayjs().tz('Asia/Tokyo').startOf('day');
		const boundaryEnd = boundaryStart.add(2, 'day');

		log.info(boundaryStart.toISOString());
		log.info(boundaryEnd.toISOString());

		const channelsMap = new Map<string, KnownBlock>();
		for (const event of events) {
		}
	}
};
