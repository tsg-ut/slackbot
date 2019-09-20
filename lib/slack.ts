import {RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import path from 'path';

export const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
export const webClient = new WebClient(process.env.SLACK_TOKEN);

export const getTokens = async (): Promise<string[]> => {
	const db = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const tokens = await db.all(sql`SELECT * FROM tokens WHERE bot_access_token <> ''`);
	await db.close();

	return tokens.map((token: any) => token.bot_access_token).concat([process.env.SLACK_TOKEN]);
};