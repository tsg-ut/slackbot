import {RTMClient, WebClient} from '@slack/client';
import {Deferred} from './utils';
import {Token} from '../oauth/tokens';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import path from 'path';

export interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
export const webClient = new WebClient(process.env.SLACK_TOKEN);

rtmClient.start();
const rtmClients = new Map<string, RTMClient>();
rtmClients.set(process.env.TEAM_ID, rtmClient);

const loadTokensDeferred = new Deferred();
const loadTokens = async () => {
	const db = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
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