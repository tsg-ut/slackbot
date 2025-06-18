import {EventEmitter} from 'events';

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
		return this.#eventAdapter.on(event, (...args: any[]) => {
			// https://slack.dev/node-slack-sdk/events-api#receive-additional-event-data
			// https://github.com/slackapi/node-slack-sdk/blob/3e9c483c593d6aa28f6f5680f287722df3327609/packages/events-api/src/http-handler.ts#L212-L223
			// https://api.slack.com/apis/connections/events-api#the-events-api__receiving-events__events-dispatched-as-json
			// args: [body.event, body: {team_id: string}]
			if (args[1].team_id === this.#team) {
				listener(...args);
			}
		});
	}
	// feel free to add any other [Events](https://nodejs.org/api/events.html) methods you want!
	
	// Add missing EventEmitter methods for compatibility
	emit(event: string | symbol, ...args: any[]): boolean {
		return this.#eventAdapter.emit(event, ...args);
	}

	removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.#eventAdapter.removeListener(event, listener);
		return this;
	}

	removeAllListeners(event?: string | symbol): this {
		this.#eventAdapter.removeAllListeners(event);
		return this;
	}

	once(event: string | symbol, listener: (...args: any[]) => void): this {
		this.#eventAdapter.once(event, listener);
		return this;
	}

	off(event: string | symbol, listener: (...args: any[]) => void): this {
		this.#eventAdapter.off(event, listener);
		return this;
	}

	addListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.#eventAdapter.addListener(event, listener);
		return this;
	}

	prependListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.#eventAdapter.prependListener(event, listener);
		return this;
	}

	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.#eventAdapter.prependOnceListener(event, listener);
		return this;
	}

	setMaxListeners(n: number): this {
		this.#eventAdapter.setMaxListeners(n);
		return this;
	}

	getMaxListeners(): number {
		return this.#eventAdapter.getMaxListeners();
	}

	listeners(event: string | symbol): Function[] {
		return this.#eventAdapter.listeners(event);
	}

	rawListeners(event: string | symbol): Function[] {
		return this.#eventAdapter.rawListeners(event);
	}

	listenerCount(event: string | symbol): number {
		return this.#eventAdapter.listenerCount(event);
	}

	eventNames(): Array<string | symbol> {
		return this.#eventAdapter.eventNames();
	}
}
