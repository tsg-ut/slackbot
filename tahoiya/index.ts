import {promises as fs, constants} from 'fs';
// @ts-ignore
import download from 'download';
import path from 'path';
import {RTMClient, WebClient, KnownBlock} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import {Mutex} from 'async-mutex';
import {sampleSize, chunk, flatten, isEmpty} from 'lodash';
// @ts-ignore
import {stripIndent} from 'common-tags';
import {Deferred} from '../lib/utils';
import {getMemberName} from '../lib/slackUtils';
import {Message} from '../lib/slackTypes';
// @ts-ignore
import logger from '../lib/logger';
import {
	getPageTitle,
	getWordUrl,
	getIconUrl,
	getTimeLink,
	getMeaning,
	getCandidateWords,
	normalizeMeaning,
} from './lib';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	messageClient: any,
}

interface UserChoice {
	type: 'user',
	user: string,
}

interface DummyChoice {
	type: 'dummy',
	source: string,
	word: string,
	text: string,
}

interface CorrectChoice {
	type: 'correct',
}

interface WordRecord {
	ruby: string,
	word: string,
	description: string,
	source: string,
}

interface Game {
	time: number,
	duration: number,
	theme: {
		ruby: string,
		word: string,
		description: string,
		source: string,
	},
	status: 'meaning' | 'betting',
	meanings: {
		[user: string]: {
			text: string,
			comment: string,
		},
	},
	bettings: {
		[user: string]: {
			choice: number,
			coins: number,
			comment: string,
		},
	},
	choices: (UserChoice | DummyChoice | CorrectChoice)[],
	author: string,
	isDaily: boolean,
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
	db: sqlite.Database;

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

		this.db = await sqlite.open(path.join(__dirname, `words.${wordsVersion}.sqlite3`));

		const statePath = path.resolve(__dirname, 'state.json');
		const stateExists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
		if (stateExists) {
			const stateData = await fs.readFile(statePath);
			Object.assign(this.state, JSON.parse(stateData.toString()));
		}

		this.slackInteractions.action({
			type: 'button',
			blockId: /^tahoiya_add_meaning/,
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;
			mutex.runExclusive(() => ( 
				this.showMeaningDialog({
					triggerId: payload.trigger_id,
					word: action.value,
					user: payload.user.id,
					respond,
				})
			));
		});

		this.slackInteractions.action({
			type: 'dialog_submission',
			callbackId: 'tahoiya_add_meaning_dialog',
		}, (payload: any, respond: any) => {
			mutex.runExclusive(() => ( 
				this.registerMeaning({
					word: payload.state,
					user: payload.user.id,
					text: payload.submission.meaning,
					comment: payload.submission.comment,
					respond,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			blockId: /^start_tahoiya/,
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;
			mutex.runExclusive(() => ( 
				this.startTahoiya({
					word: action.value,
					respond,
					user: payload.user.id,
				})
			));
		});

		loadDeferred.resolve();
	}

	async generateCandidates() {
		if (this.state.games.length > 2) {
			throw new Error('たほいやを同時に3つ以上開催することはできないよ:imp:');
		}

		const candidates = sampleSize(this.words, 20);

		return this.tsgSlack.chat.postMessage({
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

	async startTahoiya({word, respond, user}: {word: string, respond: any, user: string}) {
		if (this.state.games.length > 2) {
			respond({
				text: 'たほいやを同時に3つ以上開催することはできないよ:imp:',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return;
		}

		const theme: WordRecord = await this.db.get(sql`
			SELECT *
			FROM words
			WHERE ruby = ${word}
			ORDER BY RANDOM()
			LIMIT 1
		`);

		const now = Date.now();
		const game: Game = {
			time: now,
			duration: 5 * 60 * 1000,
			theme,
			status: 'meaning',
			meanings: Object.create(null),
			bettings: Object.create(null),
			choices: [],
			author: user,
			isDaily: false,
		};

		await this.setState({
			games: this.state.games.concat([game]),
		});

		return this.tsgSlack.chat.postMessage({
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
							終了予定時刻: ${getTimeLink(game.time + game.duration)}
						`,
					},
				},
				{type: 'divider'},
				...(await this.getGameBlocks()),
			],
		});
	}

	async showMeaningDialog({triggerId, word, user, respond}: {triggerId: string, word: string, user: string, respond: any}) {
		const game = this.state.games.find((game) => game.theme.ruby === word);
		if (!game) {
			respond({
				text: 'Error: Game not found',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return;
		}

		const {text, comment} = game.meanings[user] || {text: '', comment: ''};

		return this.tsgSlack.dialog.open({
			trigger_id: triggerId,
			dialog: {
				callback_id: 'tahoiya_add_meaning_dialog',
				title: `「${word}」の意味を考えてね！`,
				submit_label: '登録する',
				notify_on_cancel: true,
				state: word,
				elements: [
					{
						type: 'text',
						label: `「${word}」の意味`,
						name: 'meaning',
						min_length: 3,
						value: text,
						hint: '後から変更できます',
					},
					{
						type: 'textarea',
						label: 'コメント',
						name: 'comment',
						optional: true,
						value: comment,
						hint: '後から変更できます',
					},
				],
			},
		});
	}

	async registerMeaning({word, user, text, comment, respond}: {word: string, user: string, text: string, comment: string, respond: any}) {
		const game = this.state.games.find((game) => game.theme.ruby === word);
		if (!game) {
			respond({
				text: 'このたほいやの意味登録は終了しているよ:cry:',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return;
		}

		game.meanings[user] = {text, comment};
		await this.setState({
			games: this.state.games,
		});

		const humanCount = Object.keys(game.meanings).filter((user) => user.startsWith('U')).length;
		const remainingText = game.isDaily ? (
			humanCount > 3 ? '' : (
				humanCount === 3 ? '(決行決定:tada:)'
					: `(決行まであと${3 - humanCount}人)`
			)
		) : '';

		return this.tsgSlack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			text: stripIndent`
				${this.getMention(user)} が意味を登録したよ:muscle:
				現在の参加者: ${humanCount}人 ${remainingText}
			`,
		})
	}

	async showStatus() {
		return this.tsgSlack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			text: '',
			blocks: [
				...(await this.getGameBlocks()),
			],
		});
	}

	async setState(object: Partial<State>) {
		Object.assign(this.state, object);
		const statePath = path.resolve(__dirname, 'state.json');
		await fs.writeFile(statePath, JSON.stringify(this.state));
	}

	getMention(user: string) {
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		return `<@${user}>`;
	};

	getGameStatus(game: Game) {
		if (game.status === 'meaning') {
			return '意味登録中';
		}

		return 'ベッティング中';
	}

	async getGameBlocks(): Promise<KnownBlock[]> {
		if (this.state.games.length === 0) {
			return [{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: '現在行われているたほいやはありません:cry:'
				},
			}];
		}

		const gameBlocks = await Promise.all(this.state.games.map(async (game, index) => ([
			{
				type: 'section',
				block_id: `tahoiya_add_meaning_${index}`,
				text: {
					type: 'mrkdwn',
					text: stripIndent`
						🍣 お題＊「${game.theme.ruby}」＊ by ${this.getMention(game.author)}
						＊${this.getGameStatus(game)}＊ 終了予定時刻: ${getTimeLink(game.time + game.duration)}
					`,
				},
				accessory: {
					type: 'button',
					text: {
						type: 'plain_text',
						text: '登録する',
					},
					value: game.theme.ruby,
				},
			} as KnownBlock,
			...(isEmpty(game.meanings) ? [] : [
				{
					type: 'context',
					elements: Object.keys(game.meanings).map((user) => ({
						type: 'image',
						image_url: 'https://placehold.it/48x48',
						alt_text: 'hoge',
					})),
				} as KnownBlock,
			]),
		])));

		return flatten(gameBlocks);
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

		if (text === 'たほいや') {
			mutex.runExclusive(async () => ( 
				tahoiya.generateCandidates().catch((error) => {
					console.error(error);
				})
			));
		}

		if (text === 'たほいや 状況') {
			mutex.runExclusive(async () => ( 
				tahoiya.showStatus().catch((error) => {
					console.error(error);
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
