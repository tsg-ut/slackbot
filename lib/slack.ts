import {WebClient} from '@slack/web-api';
import {RTMClient} from '@slack/rtm-api';
import {createMessageAdapter} from '@slack/interactive-messages';
import {createEventAdapter} from '@slack/events-api';
import sql from 'sql-template-strings';
import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import {TSGEventClient} from './slackEventClient';
import {Deferred} from './utils';
import {Token} from '../oauth/tokens';

export interface SlackInterface {
	rtmClient: RTMClient;
	webClient: WebClient;
	eventClient: TSGEventClient;
	messageClient: ReturnType<typeof createMessageAdapter>;
};

export interface SlashCommandEndpoint {
	Body: {
		token: string;
		team_id: string;
		team_domain: string;
		enterprise_id: string;
		enterprise_name: string;
		channel_id: string;
		channel_name: string;
		user_id: string;
		user_name: string;
		command: string;
		text: string;
		response_url: string;
		trigger_id: string;
		api_app_id: string;
	};
}

export interface SlackOauthEndpoint {
	Querystring: {
		code: string;
	};
}

export const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
export const webClient = new WebClient(process.env.SLACK_TOKEN);
export const eventClient = createEventAdapter(process.env.SIGNING_SECRET, {includeBody: true});
export const messageClient = createMessageAdapter(process.env.SIGNING_SECRET);
export const tsgEventClient = new TSGEventClient(
	eventClient,
	process.env.TEAM_ID,
);


rtmClient.start();
const rtmClients = new Map<string, RTMClient>();
rtmClients.set(process.env.TEAM_ID, rtmClient);

const loadTokensDeferred = new Deferred<Token[]>();
const loadTokens = async () => {
	const db = await sqlite.open({
		filename: path.join(__dirname, '..', 'tokens.sqlite3'),
		driver: sqlite3.Database,
	});
	const tokens = await db.all(sql`SELECT * FROM tokens WHERE bot_access_token <> ''`).catch(() => []);
	await db.close();

	for (const token of tokens) {
		const rtmClient = new RTMClient(token.bot_access_token);
		rtmClient.start();
		rtmClients.set(token.team_id, rtmClient);
	}

	loadTokensDeferred.resolve(tokens.concat([{
		team_id: process.env.TEAM_ID,
		team_name: process.env.TEAMNAME,
		access_token: process.env.HAKATASHI_TOKEN,
		bot_access_token: process.env.SLACK_TOKEN,
	}]));
};

loadTokens();

export const getTokens = (): Promise<Token[]> => loadTokensDeferred.promise;

export const getRtmClient = async (teamId: string): Promise<RTMClient> => {
	await loadTokensDeferred.promise;
	return rtmClients.get(teamId);
};
