"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamEventClient = void 0;
class TeamEventClient {
    #eventAdapter;
    #team;
    // contract: 渡されるeventAdapterは、EventAdapterOptions.includeBodyがtrueでなければならない。
    constructor(eventAdapter, team) {
        this.#eventAdapter = eventAdapter;
        this.#team = team;
    }
    // listen on events against all teams.
    onAllTeam(event, listener) {
        return this.#eventAdapter.on(event, listener);
    }
    // listen on events against the team.
    on(event, listener) {
        return this.#eventAdapter.on(event, (...args) => {
            // https://slack.dev/node-slack-sdk/events-api#receive-additional-event-data
            // https://github.com/slackapi/node-slack-sdk/blob/3e9c483c593d6aa28f6f5680f287722df3327609/packages/events-api/src/http-handler.ts#L212-L223
            // https://api.slack.com/apis/connections/events-api#the-events-api__receiving-events__events-dispatched-as-json
            // args: [body.event, body: {team_id: string}]
            if (args[1].team_id === this.#team) {
                listener(...args);
            }
        });
    }
}
exports.TeamEventClient = TeamEventClient;
