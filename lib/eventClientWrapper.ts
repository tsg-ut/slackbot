import type {SlackEventAdapter} from '@slack/events-api';
import {getDuplicateEventChecker} from './eventDeduplication';
import logger from './logger';
import {EventEmitter} from 'events';

const log = logger.child({ bot: 'EventClientWrapper' });

// Slackのイベント重複除去を行うEventClientのラッパー
export class EventClientWrapper extends EventEmitter {
	readonly #eventAdapter: SlackEventAdapter;
	#registeredEvents: Set<string> = new Set();
	expressMiddleware: typeof SlackEventAdapter.prototype.expressMiddleware;

	constructor(eventAdapter: SlackEventAdapter) {
		super();
		this.#eventAdapter = eventAdapter;
		this.expressMiddleware = this.#eventAdapter.expressMiddleware.bind(this.#eventAdapter);
	}

	private setupEventHandler(event: string): void {
		if (this.#registeredEvents.has(event)) {
			return;
		}

		this.#registeredEvents.add(event);
		
		this.#eventAdapter.on(event, async (...args: any[]) => {
			const [, eventBody] = args;
			const eventId = eventBody?.event_id;

			if (eventId) {
				const duplicateChecker = getDuplicateEventChecker();
				const wasAlreadyProcessed = await duplicateChecker.markEventAsProcessed(eventId);

				if (wasAlreadyProcessed) {
					log.debug(`Duplicate event detected (id: ${eventId}), skipping`, { eventId, event });
					return;
				}
			} else {
				log.warn('Event without event_id received', { event, teamId: eventBody.team_id });
			}

			// Emit the event to our own listeners after deduplication
			this.emit(event, ...args);
		});
	}

	on(event: string, listener: (...args: any[]) => void): this {
		this.setupEventHandler(event);
		return super.on(event, listener);
	}

	addListener(event: string, listener: (...args: any[]) => void): this {
		return this.on(event, listener);
	}

	once(event: string, listener: (...args: any[]) => void): this {
		this.setupEventHandler(event);
		return super.once(event, listener);
	}

	prependListener(event: string, listener: (...args: any[]) => void): this {
		this.setupEventHandler(event);
		return super.prependListener(event, listener);
	}

	prependOnceListener(event: string, listener: (...args: any[]) => void): this {
		this.setupEventHandler(event);
		return super.prependOnceListener(event, listener);
	}
}