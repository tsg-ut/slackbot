import type {EventEmitter} from 'events';
import {getDuplicateEventChecker} from './eventDeduplication';
import logger from './logger';

const log = logger.child({ bot: 'TeamEventClient' });

export class TeamEventClient {
	readonly #eventAdapter: EventEmitter;
	readonly #team: string;

	// contract: 渡されるeventAdapterは、EventAdapterOptions.includeBodyがtrueでなければならない。
	constructor(eventAdapter: EventEmitter, team: string) {
		this.#eventAdapter = eventAdapter;
		this.#team = team;
	}

	// listen on events against all teams.
	onAllTeam(event: string, listener: (...args: any[]) => void): any {
		return this.#eventAdapter.on(event, listener);
	}
	// listen on events against the team.
	on(event: string, listener: (...args: any[]) => void): any {
		return this.#eventAdapter.on(event, async (...args: any[]) => {
			// https://slack.dev/node-slack-sdk/events-api#receive-additional-event-data
			// https://github.com/slackapi/node-slack-sdk/blob/3e9c483c593d6aa28f6f5680f287722df3327609/packages/events-api/src/http-handler.ts#L212-L223
			// https://api.slack.com/apis/connections/events-api#the-events-api__receiving-events__events-dispatched-as-json
			// args: [body.event, body: {team_id: string, event_id?: string}]
			if (args[1].team_id !== this.#team) {
				return;
			}

			// イベントIDベースの重複チェック
			const eventId = args[1].event_id;
			if (eventId) {
				const duplicateChecker = getDuplicateEventChecker();
				const isProcessed = await duplicateChecker.isEventProcessed(eventId);
				
				if (isProcessed) {
					log.debug('Duplicate event detected, skipping', { eventId, event });
					return;
				}

				await duplicateChecker.markEventAsProcessed(eventId);
			} else {
				log.warn('Event without event_id received', { event, teamId: args[1].team_id });
			}

			listener(...args);
		});
	}

	// feel free to add any other [Events](https://nodejs.org/api/events.html) methods you want!
}
