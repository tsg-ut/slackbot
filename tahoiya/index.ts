import {promises as fs, constants} from 'fs';
// @ts-ignore
import download from 'download';
import path from 'path';
import {RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import {Deferred} from '../lib/utils';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

const loadDeferred = new Deferred();

const load = async () => {
	if (loadDeferred.isResolved) {
		return loadDeferred.promise;
	}

	for (const file of ['words.txt', 'words.sqlite3']) {
		const filePath = path.resolve(__dirname, file);
		const exists = await fs.access(filePath, constants.F_OK).then(() => true).catch(() => false);
		if (!exists) {
			await download(`https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/tahoiya/${file}`, __dirname, {
				filename: file,
			});
		}
	}

	const wordsBuffer = await fs.readFile(path.resolve(__dirname, 'words.txt'));
	const words = wordsBuffer.toString().split('\n').filter((l) => l.length > 0);
	return loadDeferred.resolve({words});
};

module.exports = async ({rtmClient: tsgRtm, webClient: tsgSlack}: SlackInterface) => {
	const tokensDb = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const kmcToken = await tokensDb.get(sql`SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`);
	const kmcSlack = kmcToken === undefined ? null : new WebClient(kmcToken.bot_access_token);
	const kmcRtm = kmcToken === undefined ? null : new RTMClient(kmcToken.bot_access_token);

	const {team: tsgTeam}: any = await tsgSlack.team.info();

	const {words} = await load();
	console.log(words);
};
