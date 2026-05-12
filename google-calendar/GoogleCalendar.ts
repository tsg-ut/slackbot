import {randomUUID} from 'crypto';
import type {BlockAction, ViewSubmitAction} from '@slack/bolt';
import type {SlackMessageAdapter} from '@slack/interactive-messages';
import type {WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {uniq} from 'lodash';
import {scheduleJob} from 'node-schedule';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {
	getCalendarInfo,
	getServiceAccountEmail,
	listUpcomingEvents,
	syncCalendarEvents,
} from './calendarClient';
import {syncToDiscord} from './discordSync';
import type {StateObj, Subscription} from './types';
import addSubscriptionModal from './views/addSubscriptionModal';
import type {EventMessage} from './views/eventMessages';
import {
	dailySummaryMessage,
	eventAddedMessage,
	eventBeforeMessage,
	eventDeletedMessage,
	eventStartMessage,
	weeklySummaryMessage,
} from './views/eventMessages';
import settingsModal from './views/settingsModal';

const log = logger.child({bot: 'google-calendar'});
const mutex = new Mutex();

const BOT_USERNAME = '予定通知くん';
const BOT_ICON_EMOJI = ':blob-sunglasses:';

const getTodayStr = (): string => new Date().toISOString().slice(0, 10);

const getWeekStr = (): string => {
	const now = new Date();
	const jan1 = new Date(now.getFullYear(), 0, 1);
	const weekNumber = Math.ceil(
		((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7,
	);
	return `${now.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
};

const isGoneError = (error: unknown): boolean => {
	if (error instanceof Error && error.message.includes('410')) {
		return true;
	}
	const errObj = error as {code?: number; status?: number};
	return errObj?.code === 410 || errObj?.status === 410;
};

interface ChannelMetadata {
	channelId: string;
}

export class GoogleCalendar {
	readonly #slack: WebClient;

	readonly #interactions: SlackMessageAdapter;

	#state: StateObj;

	static async create(slack: SlackInterface): Promise<GoogleCalendar> {
		log.info('Creating Google Calendar bot instance');
		const state = await State.init<StateObj>('google-calendar', {
			subscriptions: [],
			syncTokens: {},
			sentNotifications: [],
			lastDailySummary: {},
			lastWeeklySummary: {},
			discordEventMap: {},
			discordRecurringEventMap: {},
		});
		log.debug(`Loaded state with ${state.subscriptions.length} subscription(s)`);
		return new GoogleCalendar(slack, state);
	}

	constructor(slack: SlackInterface, state: StateObj) {
		this.#slack = slack.webClient;
		this.#interactions = slack.messageClient;
		this.#state = state;

		this.#interactions.action(
			{type: 'button', actionId: 'gcal_delete_subscription'},
			(payload: BlockAction) => {
				log.debug('gcal_delete_subscription action received');
				mutex.runExclusive(() => this.#handleDeleteSubscription(payload));
			},
		);

		this.#interactions.action(
			{type: 'button', actionId: 'gcal_show_add_subscription'},
			(payload: BlockAction) => {
				log.debug('gcal_show_add_subscription action received');
				mutex.runExclusive(() => this.#handleShowAddSubscription(payload));
			},
		);

		this.#interactions.viewSubmission('gcal_add_subscription', (payload: ViewSubmitAction) => {
			log.debug('gcal_add_subscription view submission received');
			return mutex.runExclusive(() => this.#handleAddSubscriptionSubmit(payload));
		});
	}

	initialize() {
		log.info('Initializing Google Calendar bot schedules');

		scheduleJob('*/5 * * * *', () => {
			log.debug('Calendar change poll triggered');
			mutex.runExclusive(() => this.pollCalendarChanges());
		});

		scheduleJob('* * * * *', () => {
			log.debug('Upcoming notification check triggered');
			mutex.runExclusive(() => this.checkUpcomingNotifications());
		});

		scheduleJob('0 * * * *', () => {
			log.debug('Scheduled summary check triggered');
			mutex.runExclusive(() => this.checkScheduledSummaries());
		});

		const discordSyncCalendarId = process.env.GCAL_DISCORD_SYNC_CALENDAR_ID;
		if (discordSyncCalendarId) {
			scheduleJob('0 * * * *', () => {
				log.debug('Discord event sync triggered');
				mutex.runExclusive(() => syncToDiscord(
					discordSyncCalendarId,
					this.#state.discordEventMap,
					this.#state.discordRecurringEventMap,
				));
			});
			log.info(`Discord event sync enabled for calendar ${discordSyncCalendarId}`);
		} else {
			log.info('GCAL_DISCORD_SYNC_CALENDAR_ID not set, Discord event sync disabled');
		}
	}

	async showSettingsModal(channelId: string, triggerId: string) {
		log.debug(`Opening settings modal for channel ${channelId}`);
		const subs = this.#state.subscriptions.filter((s) => s.channelId === channelId);
		log.debug(`Found ${subs.length} subscription(s) for channel ${channelId}`);
		await this.#slack.views.open({
			trigger_id: triggerId,
			view: settingsModal(subs, channelId),
		});
	}

	async #handleDeleteSubscription(payload: BlockAction) {
		const action = payload.actions.find((a) => a.action_id === 'gcal_delete_subscription');
		if (!action || action.type !== 'button' || !payload.view) {
			return;
		}

		const subscriptionId = action.value;
		const metadata = this.#parseMetadata(payload.view?.private_metadata);
		if (!metadata) {
			log.debug('Delete subscription: could not parse metadata');
			return;
		}

		log.info(`Deleting subscription ${subscriptionId} from channel ${metadata.channelId}`);

		const idx = this.#state.subscriptions.findIndex((s) => s.id === subscriptionId);
		if (idx === -1) {
			log.debug(`Subscription ${subscriptionId} not found`);
		} else {
			this.#state.subscriptions.splice(idx, 1);
			log.debug(`Subscription ${subscriptionId} removed`);
		}

		const subs = this.#state.subscriptions.filter(
			(s) => s.channelId === metadata.channelId,
		);
		await this.#slack.views.update({
			view_id: payload.view.id,
			view: settingsModal(subs, metadata.channelId),
		});
		log.debug('Settings modal updated after deletion');
	}

	async #handleShowAddSubscription(payload: BlockAction) {
		const metadata = this.#parseMetadata(payload.view?.private_metadata);
		if (!metadata) {
			log.debug('Show add subscription: could not parse metadata');
			return;
		}

		log.debug(`Pushing add subscription modal for channel ${metadata.channelId}`);
		await this.#slack.views.push({
			trigger_id: payload.trigger_id,
			view: addSubscriptionModal(metadata.channelId),
		});
	}

	async #handleAddSubscriptionSubmit(payload: ViewSubmitAction) {
		const metadata = this.#parseMetadata(payload.view.private_metadata);
		if (!metadata) {
			log.debug('Add subscription submit: could not parse metadata');
			return undefined;
		}

		const values = payload.view.state?.values ?? {};

		const calendarId =
			(values.calendar_id_block?.calendar_id as {value?: string} | undefined)?.value?.trim() ?? '';

		const selectedOptions =
			(values.notifications_block?.notifications as {selected_options?: {value: string}[]} | undefined)
				?.selected_options ?? [];
		const onAddDelete = selectedOptions.some((o) => o.value === 'on_add_delete');
		const onStart = selectedOptions.some((o) => o.value === 'on_start');

		const minutesBeforeRaw =
			(values.minutes_before_block?.minutes_before as {value?: string} | undefined)?.value;
		const minutesBefore = minutesBeforeRaw ? parseInt(minutesBeforeRaw) : null;

		const dailyHourRaw =
			(values.daily_hour_block?.daily_hour as {selected_option?: {value: string}} | undefined)
				?.selected_option?.value;
		const dailyHour = dailyHourRaw === undefined ? null : parseInt(dailyHourRaw);

		const weeklyDayRaw =
			(values.weekly_day_block?.weekly_day as {selected_option?: {value: string}} | undefined)
				?.selected_option?.value;
		const weeklyDay = weeklyDayRaw === undefined ? null : parseInt(weeklyDayRaw);

		const weeklyHourRaw =
			(values.weekly_hour_block?.weekly_hour as {selected_option?: {value: string}} | undefined)
				?.selected_option?.value;
		const weeklyHour = weeklyHourRaw === undefined ? null : parseInt(weeklyHourRaw);

		log.debug(`Add subscription submit: calendarId=${calendarId}, channel=${metadata.channelId}`);

		if (!calendarId) {
			log.debug('Add subscription submit: empty calendarId');
			return {
				response_action: 'errors' as const,
				errors: {calendar_id_block: 'カレンダーIDを入力してください。'},
			};
		}

		if ((weeklyDay === null) !== (weeklyHour === null)) {
			log.debug('Add subscription submit: weekly day/hour mismatch');
			return {
				response_action: 'errors' as const,
				errors: {
					weekly_day_block:
						'毎週サマリーを設定する場合は、曜日と時刻の両方を選択してください。',
				},
			};
		}

		log.debug(`Fetching calendar info for ${calendarId}`);
		let calendarName = '';
		try {
			const info = await getCalendarInfo(calendarId);
			calendarName = info.summary;
			log.debug(`Calendar info fetched: name="${calendarName}"`);
		} catch (error: unknown) {
			const serviceAccountEmail = getServiceAccountEmail();
			const errMsg = error instanceof Error ? error.message : String(error);
			log.debug(`Calendar access failed for ${calendarId}: ${errMsg}`);

			const isAccessDenied =
				errMsg.includes('403') ||
				errMsg.includes('notFound') ||
				errMsg.includes('404') ||
				errMsg.includes('insufficientPermissions');

			const hint = isAccessDenied
				? `このカレンダーへのアクセス権がありません。カレンダーの「設定と共有」→「特定のユーザーとの共有」に以下のサービスアカウントを追加してください: ${serviceAccountEmail}`
				: `カレンダーへのアクセスに失敗しました。カレンダーの「設定と共有」→「特定のユーザーとの共有」に以下のサービスアカウントを追加してください: ${serviceAccountEmail} (error: ${errMsg})`;

			return {
				response_action: 'errors' as const,
				errors: {calendar_id_block: hint},
			};
		}

		const subscription: Subscription = {
			id: randomUUID(),
			channelId: metadata.channelId,
			calendarId,
			calendarName,
			onAddDelete,
			onStart,
			minutesBefore: minutesBefore === null || isNaN(minutesBefore) ? null : minutesBefore,
			dailyHour: dailyHour === null || isNaN(dailyHour) ? null : dailyHour,
			weeklyDay: weeklyDay === null || isNaN(weeklyDay) ? null : weeklyDay,
			weeklyHour: weeklyHour === null || isNaN(weeklyHour) ? null : weeklyHour,
		};

		log.info(
			`Adding subscription for calendar "${calendarName}" (${calendarId}) to channel ${metadata.channelId}`,
		);
		this.#state.subscriptions.push(subscription);

		const rootViewId = (payload.view as {root_view_id?: string}).root_view_id;
		if (rootViewId && rootViewId !== payload.view.id) {
			log.debug(`Updating parent settings modal (viewId=${rootViewId})`);
			const subs = this.#state.subscriptions.filter(
				(s) => s.channelId === metadata.channelId,
			);
			await this.#slack.views.update({
				view_id: rootViewId,
				view: settingsModal(subs, metadata.channelId),
			});
		}

		return undefined;
	}

	async pollCalendarChanges() {
		const calendarIds = uniq(this.#state.subscriptions.map((s) => s.calendarId));
		log.debug(`Polling changes for ${calendarIds.length} calendar(s)`);

		for (const calendarId of calendarIds) {
			const previousSyncToken = this.#state.syncTokens[calendarId] ?? null;
			log.debug(
				`Syncing calendar ${calendarId} (syncToken=${previousSyncToken === null ? 'none' : 'present'})`,
			);

			try {
				const {events, nextSyncToken} = await syncCalendarEvents(
					calendarId,
					previousSyncToken,
				);

				this.#state.syncTokens[calendarId] = nextSyncToken;
				log.debug(`Synced calendar ${calendarId}: ${events.length} event(s) in delta`);

				if (previousSyncToken === null) {
					log.debug(`Initial sync for ${calendarId}, skipping notifications`);
					continue;
				}

				const addDeleteSubs = this.#state.subscriptions.filter(
					(s) => s.calendarId === calendarId && s.onAddDelete,
				);

				for (const event of events) {
					const isDeleted = event.status === 'cancelled';
					log.debug(
						`Event change: "${event.summary}" status=${event.status} → notifying ${addDeleteSubs.length} subscription(s)`,
					);
					const message = isDeleted ? eventDeletedMessage(event) : eventAddedMessage(event);

					for (const sub of addDeleteSubs) {
						await this.#postMessage(sub.channelId, message);
					}
				}
			} catch (error) {
				if (isGoneError(error)) {
					log.warn(
						`Sync token expired for calendar ${calendarId}, will perform full resync`,
					);
					delete this.#state.syncTokens[calendarId];
				} else {
					log.error(`Failed to sync calendar ${calendarId}`, {error});
				}
			}
		}
	}

	async checkUpcomingNotifications() {
		const now = new Date();
		const cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

		const prevCount = this.#state.sentNotifications.length;
		this.#state.sentNotifications = this.#state.sentNotifications.filter((key) => {
			const [, , , dateStr] = key.split(':');
			return dateStr !== undefined && new Date(dateStr) > cutoff;
		});
		const pruned = prevCount - this.#state.sentNotifications.length;
		if (pruned > 0) {
			log.debug(`Pruned ${pruned} stale sent-notification key(s)`);
		}

		const relevantSubs = this.#state.subscriptions.filter(
			(s) => s.onStart || s.minutesBefore !== null,
		);

		if (relevantSubs.length === 0) {
			log.debug('No subscriptions with upcoming notification settings, skipping');
			return;
		}

		const calendarIds = uniq(relevantSubs.map((s) => s.calendarId));
		log.debug(`Checking upcoming notifications for ${calendarIds.length} calendar(s)`);

		for (const calendarId of calendarIds) {
			const calendarSubs = relevantSubs.filter((s) => s.calendarId === calendarId);
			const maxLookahead = Math.max(
				...calendarSubs.map((s) => (s.minutesBefore ?? 0)),
				1,
			);

			const windowEnd = new Date(now.getTime() + (maxLookahead + 2) * 60 * 1000);
			log.debug(
				`Fetching events for ${calendarId} in window [now, +${maxLookahead + 2}min]`,
			);

			try {
				const events = await listUpcomingEvents(calendarId, now, windowEnd);
				log.debug(`Found ${events.length} upcoming event(s) for ${calendarId}`);

				for (const event of events) {
					if (!event.start?.dateTime || !event.id) {
						continue;
					}

					const startTime = new Date(event.start.dateTime);
					const minutesUntilStart = (startTime.getTime() - now.getTime()) / 60000;

					for (const sub of calendarSubs) {
						if (sub.onStart && minutesUntilStart >= 0 && minutesUntilStart < 1) {
							const key = `${sub.id}:start:${event.id}:${getTodayStr()}`;
							if (this.#state.sentNotifications.includes(key)) {
								log.debug(
									`Start notification already sent for event "${event.summary}" (key=${key})`,
								);
							} else {
								log.info(
									`Sending start notification for event "${event.summary}" to channel ${sub.channelId}`,
								);
								this.#state.sentNotifications.push(key);
								await this.#postMessage(sub.channelId, eventStartMessage(event));
							}
						}

						if (sub.minutesBefore !== null) {
							const diff = Math.abs(minutesUntilStart - sub.minutesBefore);
							if (diff < 1) {
								const key = `${sub.id}:before:${event.id}:${getTodayStr()}`;
								if (this.#state.sentNotifications.includes(key)) {
									log.debug(
										`Before notification already sent for event "${event.summary}" (key=${key})`,
									);
								} else {
									log.info(
										`Sending ${sub.minutesBefore}min-before notification for event "${event.summary}" to channel ${sub.channelId}`,
									);
									this.#state.sentNotifications.push(key);
									await this.#postMessage(
										sub.channelId,
										eventBeforeMessage(event, sub.minutesBefore),
									);
								}
							}
						}
					}
				}
			} catch (error) {
				log.error(`Failed to list upcoming events for calendar ${calendarId}`, {error});
			}
		}
	}

	async checkScheduledSummaries() {
		const now = new Date();
		const currentHour = now.getHours();
		const currentDay = now.getDay();
		const today = getTodayStr();
		const thisWeek = getWeekStr();

		log.debug(
			`Checking scheduled summaries: hour=${currentHour}, day=${currentDay}, date=${today}, week=${thisWeek}`,
		);

		for (const sub of this.#state.subscriptions) {
			if (sub.dailyHour !== null && sub.dailyHour === currentHour) {
				if (this.#state.lastDailySummary[sub.id] === today) {
					log.debug(`Daily summary already sent today for subscription ${sub.id}`);
				} else {
					log.info(
						`Sending daily summary for subscription ${sub.id} (calendar: ${sub.calendarName})`,
					);
					try {
						const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000);
						const events = await listUpcomingEvents(sub.calendarId, now, timeMax);
						log.debug(`Daily summary: ${events.length} event(s) found`);
						if (events.length > 0) {
							await this.#postMessage(sub.channelId, dailySummaryMessage(events, now));
						} else {
							log.debug('Daily summary: no events, skipping post');
						}
						this.#state.lastDailySummary[sub.id] = today;
					} catch (error) {
						log.error(
							`Failed to send daily summary for subscription ${sub.id}`,
							{error},
						);
					}
				}
			}

			if (
				sub.weeklyDay !== null &&
				sub.weeklyHour !== null &&
				sub.weeklyDay === currentDay &&
				sub.weeklyHour === currentHour
			) {
				if (this.#state.lastWeeklySummary[sub.id] === thisWeek) {
					log.debug(`Weekly summary already sent this week for subscription ${sub.id}`);
				} else {
					log.info(
						`Sending weekly summary for subscription ${sub.id} (calendar: ${sub.calendarName})`,
					);
					try {
						const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
						const events = await listUpcomingEvents(sub.calendarId, now, timeMax);
						log.debug(`Weekly summary: ${events.length} event(s) found`);
						if (events.length > 0) {
							await this.#postMessage(sub.channelId, weeklySummaryMessage(events, now));
						} else {
							log.debug('Weekly summary: no events, skipping post');
						}
						this.#state.lastWeeklySummary[sub.id] = thisWeek;
					} catch (error) {
						log.error(
							`Failed to send weekly summary for subscription ${sub.id}`,
							{error},
						);
					}
				}
			}
		}
	}

	#parseMetadata(raw: string | null | undefined): ChannelMetadata | null {
		if (!raw) {
			return null;
		}
		try {
			const parsed = JSON.parse(raw) as Partial<ChannelMetadata>;
			if (!parsed.channelId) {
				return null;
			}
			return {channelId: parsed.channelId};
		} catch {
			return null;
		}
	}

	#postMessage(channelId: string, message: EventMessage) {
		log.debug(`Posting message to channel ${channelId}: "${message.text}"`);
		return this.#slack.chat.postMessage({
			channel: channelId,
			username: BOT_USERNAME,
			icon_emoji: BOT_ICON_EMOJI,
			unfurl_links: false,
			unfurl_media: false,
			...message,
		});
	}
}
