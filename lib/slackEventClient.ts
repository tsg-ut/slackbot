import {getDuplicateEventChecker} from './eventDeduplication';
import logger from './logger';
import assert from 'assert';
import type {SlackEventAdapter} from '@slack/events-api';
import { inspect } from 'util';

const log = logger.child({ bot: 'TeamEventClient' });

export class TeamEventClient {
	readonly #eventAdapter: SlackEventAdapter;
	readonly #team: string;
	#listeners: Map<string, ((...args: any[]) => void)[]> = new Map();
	#allTeamListeners: Map<string, ((...args: any[]) => void)[]> = new Map();
	#registeredEvents: Set<string> = new Set();

	static instances: TeamEventClient[] = [];

	static create(eventAdapter: SlackEventAdapter, team: string) {
		for (const instance of TeamEventClient.instances) {
			if (instance.#eventAdapter === eventAdapter && instance.#team === team) {
				return instance;
			}
		}

		const newInstance = new TeamEventClient(eventAdapter, team);
		TeamEventClient.instances.push(newInstance);
		return newInstance;
	}

	// contract: 渡されるeventAdapterは、EventAdapterOptions.includeBodyがtrueでなければならない。
	private constructor(eventAdapter: SlackEventAdapter, team: string) {
		this.#eventAdapter = eventAdapter;
		this.#team = team;
	}

	private registerEventCallback(event: string) {
		return this.#eventAdapter.on(event, async (...args: any[]) => {
			// https://slack.dev/node-slack-sdk/events-api#receive-additional-event-data
			// https://github.com/slackapi/node-slack-sdk/blob/3e9c483c593d6aa28f6f5680f287722df3327609/packages/events-api/src/http-handler.ts#L212-L223
			// https://api.slack.com/apis/connections/events-api#the-events-api__receiving-events__events-dispatched-as-json
			// args: [body.event, body: {team_id: string, event_id?: string}]
			const [, eventBody] = args;

			const listeners = this.#listeners.get(event) || [];
			const allTeamListeners = this.#allTeamListeners.get(event) || [];
			assert(listeners.length > 0 || allTeamListeners.length > 0);

			// イベントIDベースの重複チェック
			const eventId = eventBody.event_id;
			if (eventId) {
				const duplicateChecker = getDuplicateEventChecker();
				const wasAlreadyProcessed = await duplicateChecker.markEventAsProcessed(eventId);

				if (wasAlreadyProcessed) {
					log.debug(`Duplicate event detected (id: ${eventId}), skipping`, { eventId, event });
					return;
				}
			} else {
				log.warn('Event without event_id received', { event, teamId: args[1].team_id });
			}

			if (eventBody.team_id === this.#team) {
				for (const listener of listeners) {
					listener(...args);
				}
			}

			for (const listener of allTeamListeners) {
				listener(...args);
			}
		});
	}

	// listen on events against all teams.
	onAllTeam(event: string, listener: (...args: any[]) => void): any {
		if (!this.#allTeamListeners.has(event)) {
			this.#allTeamListeners.set(event, []);
		}

		this.#allTeamListeners.get(event)?.push(listener);

		if (!this.#registeredEvents.has(event)) {
			this.registerEventCallback(event);
			this.#registeredEvents.add(event);
		}
	}

	// listen on events against the team.
	on(event: string, listener: (...args: any[]) => void): any {
		if (!this.#listeners.has(event)) {
			this.#listeners.set(event, []);
		}

		this.#listeners.get(event)?.push(listener);

		if (!this.#registeredEvents.has(event)) {
			this.registerEventCallback(event);
			this.#registeredEvents.add(event);
		}
	}

	// feel free to add any other [Events](https://nodejs.org/api/events.html) methods you want!
}
