import {RTMClient, WebClient} from '@slack/client';
import {Deferred} from './utils';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import path from 'path';

export const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
export const webClient = new WebClient(process.env.SLACK_TOKEN);

rtmClient.start();
const rtmClients = new Map<string, RTMClient>();
rtmClients.set(process.env.SLACK_TOKEN, rtmClient);

const loadTokensDeferred = new Deferred();
const loadTokens = async () => {
	const db = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const tokenEntries = await db.all(sql`SELECT * FROM tokens WHERE bot_access_token <> ''`).catch(() => []);
	await db.close();

	const tokens = tokenEntries.map((token: any) => token.bot_access_token);

	loadTokensDeferred.resolve(tokens.concat([process.env.SLACK_TOKEN]));

	for (const token of tokens) {
		const rtmClient = new RTMClient(token);
		rtmClient.start();
		rtmClients.set(token, rtmClient);
	}
};

loadTokens();

export const getTokens = (): Promise<string[]> => loadTokensDeferred.promise;

export const getRtmClient = async (token: string): Promise<RTMClient> => {
	await loadTokensDeferred.promise;
	return rtmClients.get(token);
};