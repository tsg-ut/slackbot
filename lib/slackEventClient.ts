import type {SlackEventAdapter} from '@slack/events-api';

export class TSGEventClient {
	private readonly eventAdapter: SlackEventAdapter;
	private readonly team: string;

	// contract: 渡されるeventAdapterは、EventAdapterOptions.includeBodyがtrueでなければならない。
	constructor(eventAdapter: SlackEventAdapter, team: string) {
		this.eventAdapter = eventAdapter;
		this.team = team;
	}

	// listen on events against all teams.
	onAllTeam(event: string, listener: (...args: any[]) => void): any {
		return this.eventAdapter.on(event, listener);
	}
	// listen on events against TSG team.
	on(event: string, listener: (...args: any[]) => void): any {
		return this.eventAdapter.on(event, (...args: any[]) => {
			// https://slack.dev/node-slack-sdk/events-api#receive-additional-event-data
			// https://github.com/slackapi/node-slack-sdk/blob/3e9c483c593d6aa28f6f5680f287722df3327609/packages/events-api/src/http-handler.ts#L212-L223
			// args: [body.event, body]
			if (args[1].team_id === this.team) {
				listener(...args);
			}
		});
	}

	// feel free to add any other [Events](https://nodejs.org/api/events.html) methods you want!
}
