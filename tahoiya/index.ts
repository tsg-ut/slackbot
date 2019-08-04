import {promises as fs, constants} from 'fs';
// @ts-ignore
import download from 'download';
import path from 'path';
import {RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import {Mutex} from 'async-mutex';
import {Deferred} from '../lib/utils';
import {Message} from '../lib/slackTypes';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

const loadDeferred = new Deferred();

const mutex = new Mutex();

const wordsVersion = '201907260000';

const load = async () => {
	if (loadDeferred.isResolved) {
		return loadDeferred.promise;
	}

	for (const file of ['words.txt', 'words.sqlite3']) {
		const filename = file.replace(/\./, `.${wordsVersion}.`);
		const filePath = path.resolve(__dirname, filename);
		const exists = await fs.access(filePath, constants.F_OK).then(() => true).catch(() => false);
		if (!exists) {
			await download(`https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/tahoiya/${file}`, __dirname, {
				filename,
			});
		}
	}

	const wordsBuffer = await fs.readFile(path.resolve(__dirname, `words.${wordsVersion}.txt`));
	const words = wordsBuffer.toString().split('\n').filter((l) => l.length > 0);
	return loadDeferred.resolve({words});
};

const startTahoiya = async () => {
	if (state.phase !== 'waiting') {
		throw new Error('今たほいや中だよ:imp:');
	}
};

module.exports = async ({rtmClient: tsgRtm, webClient: tsgSlack}: SlackInterface) => {
	const tokensDb = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const kmcToken = await tokensDb.get(sql`SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`);
	const kmcSlack = kmcToken === undefined ? null : new WebClient(kmcToken.bot_access_token);
	const kmcRtm = kmcToken === undefined ? null : new RTMClient(kmcToken.bot_access_token);

	const {team: tsgTeam}: any = await tsgSlack.team.info();

	const {words} = await load();

	const onMessage = (message: Message, team: string) => {
		if (!message.text || message.subtype !== undefined) {
			return;
		}

		const text = message.text.trim();

		if (text === 'たほいや') {
			mutex.runExclusive(async () => ( 
				startTahoiya().catch((error) => {
					error.message;
				})
			));
		}
	};

	kmcRtm.on('message', (event) => {
		onMessage(event, 'KMC');
	});
	tsgRtm.on('message', (event) => {
		onMessage(event, 'TSG');
	});
};
