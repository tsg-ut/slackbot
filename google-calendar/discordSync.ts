import {
	GuildScheduledEventEntityType,
	GuildScheduledEventPrivacyLevel,
	GuildScheduledEventRecurrenceRuleFrequency,
	GuildScheduledEventRecurrenceRuleMonth,
	GuildScheduledEventRecurrenceRuleWeekday,
	GuildScheduledEventStatus,
} from 'discord.js';
import type {GuildScheduledEventRecurrenceRuleNWeekday, GuildScheduledEventRecurrenceRuleOptions} from 'discord.js';
import discord from '../lib/discord.js';
import logger from '../lib/logger.js';
import {getCalendarEvent, listUpcomingEvents, updateCalendarEventLocation} from './calendarClient.js';
import type {CalendarEvent} from './types.js';

const log = logger.child({bot: 'google-calendar', module: 'discordSync'});

const SYNC_LOOKAHEAD_DAYS = 30;
const MIN_MINUTES_BEFORE_START = 2;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;

const RRULE_WEEKDAY_TO_DISCORD: Record<string, GuildScheduledEventRecurrenceRuleWeekday> = {
	MO: GuildScheduledEventRecurrenceRuleWeekday.Monday,
	TU: GuildScheduledEventRecurrenceRuleWeekday.Tuesday,
	WE: GuildScheduledEventRecurrenceRuleWeekday.Wednesday,
	TH: GuildScheduledEventRecurrenceRuleWeekday.Thursday,
	FR: GuildScheduledEventRecurrenceRuleWeekday.Friday,
	SA: GuildScheduledEventRecurrenceRuleWeekday.Saturday,
	SU: GuildScheduledEventRecurrenceRuleWeekday.Sunday,
};

// All 7 weekdays, used for FREQ=DAILY with no BYDAY
const ALL_WEEKDAYS = Object.values(RRULE_WEEKDAY_TO_DISCORD) as GuildScheduledEventRecurrenceRuleWeekday[];

const parseRRuleFields = (rruleStr: string): Record<string, string> | null => {
	const matched = rruleStr.match(/^RRULE:(?<rule>.+)$/);
	if (!matched?.groups) {
		return null;
	}
	return Object.fromEntries(
		matched.groups.rule.split(';').map((part) => {
			const eqIdx = part.indexOf('=');
			return [part.slice(0, eqIdx), part.slice(eqIdx + 1)];
		}),
	);
};

const rruleToDiscordRecurrenceRule = (
	recurrence: string[],
	startAt: Date,
): GuildScheduledEventRecurrenceRuleOptions | null => {
	const rruleStr = recurrence.find((r) => r.startsWith('RRULE:'));
	if (!rruleStr) {
		return null;
	}

	const fields = parseRRuleFields(rruleStr);
	if (!fields?.FREQ) {
		return null;
	}

	const {FREQ: freq} = fields;
	const interval = fields.INTERVAL ? parseInt(fields.INTERVAL) : 1;
	const bydayValues = fields.BYDAY ? fields.BYDAY.split(',') : null;

	if (freq === 'DAILY' || freq === 'WEEKLY') {
		const byWeekday = bydayValues
			?.map((d) => RRULE_WEEKDAY_TO_DISCORD[d])
			.filter((d): d is GuildScheduledEventRecurrenceRuleWeekday => d !== undefined) ??
			(freq === 'DAILY' ? ALL_WEEKDAYS : null);

		if (!byWeekday?.length) {
			return null;
		}

		return {
			frequency: freq === 'WEEKLY'
				? GuildScheduledEventRecurrenceRuleFrequency.Weekly
				: GuildScheduledEventRecurrenceRuleFrequency.Daily,
			interval,
			startAt,
			byWeekday,
		};
	}

	if (freq === 'MONTHLY' && bydayValues) {
		const byNWeekday: GuildScheduledEventRecurrenceRuleNWeekday[] = bydayValues
			.map((d) => {
				const matched = d.match(/^(?<n>-?\d+)(?<dayStr>[A-Z]{2})$/);
				if (!matched?.groups) {
					return null;
				}
				const day = RRULE_WEEKDAY_TO_DISCORD[matched.groups.dayStr];
				if (day === undefined) {
					return null;
				}
				return {n: parseInt(matched.groups.n), day};
			})
			.filter((d): d is GuildScheduledEventRecurrenceRuleNWeekday => d !== null);

		if (!byNWeekday.length) {
			return null;
		}

		return {
			frequency: GuildScheduledEventRecurrenceRuleFrequency.Monthly,
			interval,
			startAt,
			byNWeekday,
		};
	}

	if (freq === 'YEARLY') {
		const byMonths = fields.BYMONTH?.split(',').map(Number);
		const byMonthDays = fields.BYMONTHDAY?.split(',').map(Number);

		if (!byMonths?.length || !byMonthDays?.length) {
			return null;
		}

		return {
			frequency: GuildScheduledEventRecurrenceRuleFrequency.Yearly,
			interval,
			startAt,
			byMonth: byMonths as GuildScheduledEventRecurrenceRuleMonth[],
			byMonthDay: byMonthDays,
		};
	}

	return null;
};

const getEventStart = (event: CalendarEvent): Date | null => {
	if (event.start?.dateTime) {
		return new Date(event.start.dateTime);
	}
	if (event.start?.date) {
		const [year, month, day] = event.start.date.split('-').map(Number);
		return new Date(Date.UTC(year, month - 1, day, -9, 0, 0));
	}
	return null;
};

const getEventEnd = (event: CalendarEvent, startDate: Date): Date => {
	if (event.end?.dateTime) {
		return new Date(event.end.dateTime);
	}
	if (event.end?.date) {
		const [year, month, day] = event.end.date.split('-').map(Number);
		const exclusiveEnd = new Date(Date.UTC(year, month - 1, day, -9, 0, 0));
		return new Date(exclusiveEnd.getTime() - 1);
	}
	return new Date(startDate.getTime() + 60 * 60 * 1000);
};

const truncate = (text: string, maxLength: number): string => (
	text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
);

// Prevent writing the Discord event URL back as the Discord event's own location field.
const resolveDiscordLocation = (location: string | null | undefined): string => {
	if (!location || (/^https:\/\/discord\.com\/events\//).test(location)) {
		return 'Google Calendar';
	}
	return location;
};

const buildDescription = (
	rawDescription: string | null | undefined,
	htmlLink: string | null | undefined,
): string => {
	const cleaned = (rawDescription ?? '').trim();
	const linkSuffix = htmlLink ? `\n\n${htmlLink}` : '';
	const availableLength = MAX_DESCRIPTION_LENGTH - linkSuffix.length;
	return `${truncate(cleaned, availableLength)}${linkSuffix}`;
};

interface RecurringSeries {
	recurringEventId: string;
	// earliest upcoming instance, used for scheduledStartTime / duration
	firstInstance: CalendarEvent;
}

export const syncToDiscord = async (
	calendarId: string,
	discordEventMap: {[googleEventId: string]: string},
	discordRecurringEventMap: {[recurringEventId: string]: string},
): Promise<void> => {
	const guildId = process.env.DISCORD_SERVER_ID;
	if (!guildId) {
		log.warn('DISCORD_SERVER_ID is not set, skipping Discord sync');
		return;
	}

	if (!discord.isReady()) {
		log.warn('Discord client is not ready, skipping sync');
		return;
	}

	const guild = discord.guilds.cache.get(guildId);
	if (!guild) {
		log.warn(`Discord guild ${guildId} not found in cache`);
		return;
	}

	const now = new Date();
	const minStart = new Date(now.getTime() + MIN_MINUTES_BEFORE_START * 60 * 1000);
	const timeMax = new Date(now.getTime() + SYNC_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

	log.info(`Starting Discord event sync for calendar ${calendarId}`);

	const calendarEvents = await listUpcomingEvents(calendarId, minStart, timeMax).catch((error: unknown): null => {
		log.error('Failed to fetch Google Calendar events for Discord sync', {error});
		return null;
	});
	if (!calendarEvents) {
		return;
	}

	const existingDiscordEvents = await guild.scheduledEvents.fetch().catch((error: unknown): null => {
		log.error('Failed to fetch Discord scheduled events', {error});
		return null;
	});
	if (!existingDiscordEvents) {
		return;
	}

	const upcomingEvents = calendarEvents.filter(
		(event) => event.status !== 'cancelled' && event.id && event.summary,
	);
	log.debug(`Found ${upcomingEvents.length} upcoming Google Calendar event(s) to sync`);

	// Separate recurring instances from standalone events
	const recurringSeriesMap = new Map<string, RecurringSeries>();
	const standaloneEvents: CalendarEvent[] = [];

	for (const event of upcomingEvents) {
		if (event.recurringEventId) {
			if (!recurringSeriesMap.has(event.recurringEventId)) {
				recurringSeriesMap.set(event.recurringEventId, {
					recurringEventId: event.recurringEventId,
					firstInstance: event,
				});
			}
		} else {
			standaloneEvents.push(event);
		}
	}

	// --- Sync recurring series ---
	const processedRecurringIds = new Set<string>();

	for (const series of recurringSeriesMap.values()) {
		const {recurringEventId, firstInstance} = series;
		if (!firstInstance.id || !firstInstance.summary) {
			continue;
		}

		const startDate = getEventStart(firstInstance);
		if (!startDate) {
			continue;
		}
		const endDate = getEventEnd(firstInstance, startDate);
		const actualEnd = endDate <= startDate ? new Date(startDate.getTime() + 60 * 60 * 1000) : endDate;

		// Fetch the base event to get the RRULE
		const baseEvent = await getCalendarEvent(calendarId, recurringEventId).catch((error: unknown): null => {
			log.error(`Failed to fetch base event ${recurringEventId}`, {error});
			return null;
		});

		const recurrenceRule = baseEvent?.recurrence
			? rruleToDiscordRecurrenceRule(baseEvent.recurrence, startDate)
			: null;

		if (!recurrenceRule) {
			// Unsupported recurrence pattern: fall back to treating as individual instances
			log.debug(`Could not map recurrence rule for series ${recurringEventId}, treating as standalone`);
			standaloneEvents.push(firstInstance);
			processedRecurringIds.add(recurringEventId);
			continue;
		}

		const summary = baseEvent?.summary ?? firstInstance.summary;
		const description = baseEvent?.description ?? firstInstance.description;
		const location = baseEvent?.location ?? firstInstance.location;

		const eventPayload = {
			name: truncate(summary, MAX_NAME_LENGTH),
			scheduledStartTime: startDate,
			scheduledEndTime: actualEnd,
			description: buildDescription(description, baseEvent?.htmlLink ?? firstInstance.htmlLink),
			entityType: GuildScheduledEventEntityType.External as const,
			entityMetadata: {location: resolveDiscordLocation(location)},
			privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly as const,
			recurrenceRule,
		};

		const existingDiscordEventId = discordRecurringEventMap[recurringEventId];
		const isDiscordLocation = location?.toLowerCase() === 'discord';

		if (existingDiscordEventId) {
			const discordEvent = existingDiscordEvents.get(existingDiscordEventId);
			if (discordEvent) {
				if (discordEvent.status === GuildScheduledEventStatus.Active) {
					log.debug(`Skipping active Discord event for series ${recurringEventId}`);
					processedRecurringIds.add(recurringEventId);
					continue;
				}
				try {
					await discordEvent.edit({
						name: truncate(summary, MAX_NAME_LENGTH),
						scheduledStartTime: startDate,
						scheduledEndTime: actualEnd,
						description: buildDescription(description, baseEvent?.htmlLink ?? firstInstance.htmlLink),
						privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly as const,
						recurrenceRule,
						...(discordEvent.channelId ? {} : {entityMetadata: {location: resolveDiscordLocation(location)}}),
					});
					log.info(`Updated Discord recurring event "${summary}" (id=${existingDiscordEventId})`);
					if (isDiscordLocation) {
						await updateCalendarEventLocation(
							calendarId, recurringEventId,
							`https://discord.com/events/${guildId}/${existingDiscordEventId}`,
						).catch((error: unknown) => {
							log.error(`Failed to update Google Calendar location for "${summary}"`, {error});
						});
					}
				} catch (error: unknown) {
					log.error(`Failed to update Discord recurring event ${existingDiscordEventId}`, {error});
				}
			} else {
				try {
					const newEvent = await guild.scheduledEvents.create(eventPayload);
					discordRecurringEventMap[recurringEventId] = newEvent.id;
					log.info(`Re-created Discord recurring event "${summary}" (id=${newEvent.id})`);
					if (isDiscordLocation) {
						await updateCalendarEventLocation(
							calendarId, recurringEventId,
							`https://discord.com/events/${guildId}/${newEvent.id}`,
						).catch((error: unknown) => {
							log.error(`Failed to update Google Calendar location for "${summary}"`, {error});
						});
					}
				} catch (error: unknown) {
					log.error(`Failed to re-create Discord recurring event for "${summary}"`, {error});
				}
			}
		} else {
			try {
				const newEvent = await guild.scheduledEvents.create(eventPayload);
				discordRecurringEventMap[recurringEventId] = newEvent.id;
				log.info(`Created Discord recurring event "${summary}" (id=${newEvent.id})`);
				if (isDiscordLocation) {
					await updateCalendarEventLocation(
						calendarId, recurringEventId,
						`https://discord.com/events/${guildId}/${newEvent.id}`,
					).catch((error: unknown) => {
						log.error(`Failed to update Google Calendar location for "${summary}"`, {error});
					});
				}
			} catch (error: unknown) {
				log.error(`Failed to create Discord recurring event for "${summary}"`, {error});
			}
		}

		processedRecurringIds.add(recurringEventId);
	}

	// Delete Discord events for recurring series that no longer have upcoming instances
	for (const recurringEventId of Object.keys(discordRecurringEventMap)) {
		if (processedRecurringIds.has(recurringEventId)) {
			continue;
		}
		const discordEventId = discordRecurringEventMap[recurringEventId];
		const discordEvent = existingDiscordEvents.get(discordEventId);
		if (discordEvent) {
			if (discordEvent.status === GuildScheduledEventStatus.Active) {
				continue;
			}
			await discordEvent.delete().then(() => {
				log.info(`Deleted Discord recurring event ${discordEventId} (no upcoming instances)`);
			}).catch((error: unknown) => {
				log.error(`Failed to delete Discord recurring event ${discordEventId}`, {error});
			});
		}
		delete discordRecurringEventMap[recurringEventId];
	}

	// --- Sync standalone (non-recurring) events ---
	const processedStandaloneIds = new Set<string>();

	for (const event of standaloneEvents) {
		if (!event.id || !event.summary) {
			continue;
		}

		const startDate = getEventStart(event);
		if (!startDate) {
			continue;
		}
		const endDate = getEventEnd(event, startDate);
		const actualEnd = endDate <= startDate ? new Date(startDate.getTime() + 60 * 60 * 1000) : endDate;

		const eventPayload = {
			name: truncate(event.summary, MAX_NAME_LENGTH),
			scheduledStartTime: startDate,
			scheduledEndTime: actualEnd,
			description: buildDescription(event.description, event.htmlLink),
			entityType: GuildScheduledEventEntityType.External as const,
			entityMetadata: {location: resolveDiscordLocation(event.location)},
			privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly as const,
		};

		const existingDiscordEventId = discordEventMap[event.id];
		const isDiscordLocation = event.location?.toLowerCase() === 'discord';

		if (existingDiscordEventId) {
			const discordEvent = existingDiscordEvents.get(existingDiscordEventId);
			if (discordEvent) {
				if (discordEvent.status === GuildScheduledEventStatus.Active) {
					log.debug(`Skipping active Discord event "${event.summary}" (${existingDiscordEventId})`);
					processedStandaloneIds.add(event.id);
					continue;
				}
				try {
					await discordEvent.edit({
						name: truncate(event.summary, MAX_NAME_LENGTH),
						scheduledStartTime: startDate,
						scheduledEndTime: actualEnd,
						description: buildDescription(event.description, event.htmlLink),
						privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly as const,
						...(discordEvent.channelId ? {} : {entityMetadata: {location: resolveDiscordLocation(event.location)}}),
					});
					log.info(`Updated Discord event "${event.summary}" (id=${existingDiscordEventId})`);
					if (isDiscordLocation) {
						await updateCalendarEventLocation(
							calendarId, event.id,
							`https://discord.com/events/${guildId}/${existingDiscordEventId}`,
						).catch((error: unknown) => {
							log.error(`Failed to update Google Calendar location for "${event.summary}"`, {error});
						});
					}
				} catch (error: unknown) {
					log.error(`Failed to update Discord event ${existingDiscordEventId}`, {error});
				}
			} else {
				try {
					const newEvent = await guild.scheduledEvents.create(eventPayload);
					discordEventMap[event.id] = newEvent.id;
					log.info(`Re-created Discord event "${event.summary}" (id=${newEvent.id})`);
					if (isDiscordLocation) {
						await updateCalendarEventLocation(
							calendarId, event.id,
							`https://discord.com/events/${guildId}/${newEvent.id}`,
						).catch((error: unknown) => {
							log.error(`Failed to update Google Calendar location for "${event.summary}"`, {error});
						});
					}
				} catch (error: unknown) {
					log.error(`Failed to re-create Discord event for "${event.summary}"`, {error});
				}
			}
		} else {
			try {
				const newEvent = await guild.scheduledEvents.create(eventPayload);
				discordEventMap[event.id] = newEvent.id;
				log.info(`Created Discord event "${event.summary}" (id=${newEvent.id})`);
				if (isDiscordLocation) {
					await updateCalendarEventLocation(
						calendarId, event.id,
						`https://discord.com/events/${guildId}/${newEvent.id}`,
					).catch((error: unknown) => {
						log.error(`Failed to update Google Calendar location for "${event.summary}"`, {error});
					});
				}
			} catch (error: unknown) {
				log.error(`Failed to create Discord event for "${event.summary}"`, {error});
			}
		}

		processedStandaloneIds.add(event.id);
	}

	// Delete Discord events for standalone events that are no longer upcoming
	for (const googleEventId of Object.keys(discordEventMap)) {
		if (processedStandaloneIds.has(googleEventId)) {
			continue;
		}
		const discordEventId = discordEventMap[googleEventId];
		const discordEvent = existingDiscordEvents.get(discordEventId);
		if (discordEvent) {
			if (discordEvent.status === GuildScheduledEventStatus.Active) {
				continue;
			}
			await discordEvent.delete().then(() => {
				log.info(`Deleted Discord event ${discordEventId} (no longer upcoming)`);
			}).catch((error: unknown) => {
				log.error(`Failed to delete Discord event ${discordEventId}`, {error});
			});
		}
		delete discordEventMap[googleEventId];
	}

	log.info('Discord event sync completed');
};
