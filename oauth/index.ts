import {FastifyInstance} from 'fastify';
import type {SlackInterface, SlackOauthEndpoint} from '../lib/slack';
// @ts-ignore
import logger from '../lib/logger.js';
import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import sql from 'sql-template-strings';
import {get} from 'lodash';

export const server = ({webClient: slack}: SlackInterface) => async (fastify: FastifyInstance) => {
	const db = await sqlite.open({
		filename: path.join(__dirname, '..', 'tokens.sqlite3'),
		driver: sqlite3.Database,
	});
	await db.run(`
		CREATE TABLE IF NOT EXISTS tokens (
			team_id string PRIMARY KEY,
			team_name string,
			access_token string,
			bot_user_id string,
			bot_access_token string
		)
	`);

	fastify.get<SlackOauthEndpoint>('/oauth', async (req, res) => {
		const data = await slack.oauth.access({
			code: req.query.code,
			client_id: process.env.CLIENT_ID,
			client_secret: process.env.CLIENT_SECRET,
		});
		if (!data.ok) {
			res.code(500);
			logger.error(data);
			return 'Internal Server Error';
		}
		await db.run(sql`
			INSERT OR REPLACE INTO tokens (
				team_id,
				team_name,
				access_token,
				bot_user_id,
				bot_access_token
			) VALUES (
				${get(data, ['team_id'], null)},
				${get(data, ['team_name'], null)},
				${get(data, ['access_token'], null)},
				${get(data, ['bot', 'bot_user_id'], null)},
				${get(data, ['bot', 'bot_access_token'], null)}
			)
		`);
		return 'Successfully installed tsgbot to your workspace';
	});
};
