import {RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import path from 'path';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

module.exports = async ({rtmClient: tsgRtm, webClient: tsgSlack}: SlackInterface) => {
	const tokensDb = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const kmcToken = await tokensDb.get(sql`SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`);
	const kmcSlack = kmcToken === undefined ? null : new WebClient(kmcToken.bot_access_token);
	const kmcRtm = kmcToken === undefined ? null : new RTMClient(kmcToken.bot_access_token);

	const {team: tsgTeam}: any = await tsgSlack.team.info();
};
