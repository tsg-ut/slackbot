import {promises as fs, constants} from 'fs';
// @ts-ignore
import download from 'download';
import path from 'path';
import {RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import {Mutex} from 'async-mutex';
import {sampleSize, chunk} from 'lodash';
// @ts-ignore
import {stripIndent} from 'common-tags';
import {Deferred} from '../lib/utils';
import {Message} from '../lib/slackTypes';
// @ts-ignore
import logger from '../lib/logger';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	messageClient: any,
}

interface Game {

}

interface State {
	games: Game[],
}

const loadDeferred = new Deferred();

const mutex = new Mutex();

const wordsVersion = '201907260000';

class Tahoiya {
	tsgRtm: RTMClient;
	tsgSlack: WebClient;
	kmcRtm: RTMClient;
	kmcSlack: WebClient;
	slackInteractions: any;
	state: State;
	words: string[];

	constructor({tsgRtm, tsgSlack, kmcRtm, kmcSlack, slackInteractions}: {tsgRtm: RTMClient, tsgSlack: WebClient, kmcRtm: RTMClient, kmcSlack: WebClient, slackInteractions: any}) {
		this.tsgRtm = tsgRtm;
		this.tsgSlack = tsgSlack;
		this.kmcRtm = kmcRtm;
		this.kmcSlack = kmcSlack;
		this.slackInteractions = slackInteractions;

		this.state = {
			games: [],
		};
	}

	// TODO: lock
	async initialize() {
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
		this.words = wordsBuffer.toString().split('\n').filter((l) => l.length > 0);

		const statePath = path.resolve(__dirname, 'state.json');
		const stateExists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
		if (stateExists) {
			const stateData = await fs.readFile(statePath);
			Object.assign(this.state, JSON.parse(stateData.toString()));
		}

		this.slackInteractions.action({
			type: 'button',
			blockId: 'tahoiya_add_meaning',
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;

			this.tsgSlack.dialog.open({
				trigger_id: payload.trigger_id,
				dialog: {
					callback_id: 'tahoiya_add_meaning_dialog',
					title: `「${action.value}」の意味を考えてね！`,
					submit_label: '登録する',
					notify_on_cancel: true,
					state: action.value,
					elements: [
						{
							type: 'text',
							label: `「${action.value}」の意味`,
							name: 'meaning',
							min_length: 3,
							value: 'ほげぷがぴよぴよ',
							hint: '後から変更できます',
						},
						{
							type: 'textarea',
							label: 'コメント',
							name: 'comment',
							optional: true,
							value: 'ほげぷがぴよぴよ',
							hint: '後から変更できます',
						},
					],
				},
			});
		});

		this.slackInteractions.action({
			type: 'dialog_submission',
			callbackId: 'tahoiya_add_meaning_dialog',
		}, (payload: any, respond: any) => {
			console.log(payload);
		});

		this.slackInteractions.action({
			type: 'button',
			blockId: /^start_tahoiya/,
		}, (payload: any) => {
			const [action] = payload.actions;
			this.startTahoiya(action.value);
		});

		loadDeferred.resolve();
	}

	async generateCandidates() {
		if (this.state.games.length > 2) {
			throw new Error('たほいやを同時に3つ以上開催することはできないよ:imp:');
		}

		const candidates = sampleSize(this.words, 20);

		this.tsgSlack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			text: '',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							たのしい＊たほいや＊を始めるよ〜👏👏👏
							下のリストの中からお題にする単語を選んでクリックしてね:wink:
						`,
					},
				},
				...(chunk(candidates, 5).map((candidateGroup, index) => ({
					type: 'actions',
					block_id: `start_tahoiya_${index}`,
					elements: candidateGroup.map((candidate) => ({
						type: 'button',
						text: {
							type: 'plain_text',
							text: candidate,
						},
						value: candidate,
						confirm: {
							title: {
								type: 'plain_text',
								text: 'たほいや開始確認',
							},
							text: {
								type: 'plain_text',
								text: `お題を「${candidate}」にセットしますか?`,
							},
							confirm: {
								type: 'plain_text',
								text: 'いいよ',
							},
							deny: {
								type: 'plain_text',
								text: 'だめ',
							},
						},
					})),
				}))),
			],
		});
	}

	async startTahoiya(word: string) {
		console.log(word);
		this.tsgSlack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			text: '',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							お題を＊「${word}」＊に設定したよ:v:
						`,
					},
				},
				{type: 'divider'},
				{
					type: 'section',
					block_id: 'tahoiya_add_meaning',
					text: {
						type: 'mrkdwn',
						text: `🍣 お題＊「${word}」＊`
					},
					accessory: {
						type: 'button',
						text: {
							type: 'plain_text',
							text: '登録する',
						},
						value: word,
					},
				},
			],
		});
	}

	async setState(object: Object) {
		Object.assign(this.state, object);
		const statePath = path.resolve(__dirname, 'state.json');
		await fs.writeFile(statePath, JSON.stringify(this.state));
	}
}

module.exports = async ({rtmClient: tsgRtm, webClient: tsgSlack, messageClient: slackInteractions}: SlackInterface) => {
	const tokensDb = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const kmcToken = await tokensDb.get(sql`SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`);
	const kmcSlack = kmcToken === undefined ? null : new WebClient(kmcToken.bot_access_token);
	const kmcRtm = kmcToken === undefined ? null : new RTMClient(kmcToken.bot_access_token);

	const {team: tsgTeam}: any = await tsgSlack.team.info();

	const tahoiya = new Tahoiya({tsgSlack, tsgRtm, kmcSlack, kmcRtm, slackInteractions});
	await tahoiya.initialize();

	const onMessage = (message: Message, team: string) => {
		if (!message.text || message.subtype !== undefined) {
			return;
		}
		

		const text = message.text.trim();

		if (text === 'たほいや2.0') {
			mutex.runExclusive(async () => ( 
				tahoiya.generateCandidates().catch((error) => {
					error.message;
				})
			));
		}
	};

	tsgRtm.on('message', (event) => {
		onMessage(event, 'TSG');
	});

	if (kmcToken === undefined) {
		logger.info('Disabling KMC tahoiya because token is not found');
	} else {
		kmcRtm.on('message', (event) => {
			onMessage(event, 'KMC');
		});
	}
};
