import {constants, promises as fs} from 'fs';
// @ts-ignore
import download from 'download';
import path from 'path';
import {KnownBlock, MrkdwnElement, PlainTextElement, RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import {Mutex} from 'async-mutex';
import {chunk, flatten, isEmpty, sampleSize, size, minBy, times, sample, shuffle, map} from 'lodash';
// @ts-ignore
import {stripIndent} from 'common-tags';
// @ts-ignore
import levenshtein from 'fast-levenshtein';
import {Deferred, overflowText} from '../lib/utils';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import plugin from 'fastify-plugin';

interface UserChoice {
	type: 'user',
	user: string,
}

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	messageClient: any,
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

type Choice = UserChoice | DummyChoice | CorrectChoice;

interface WordRecord {
	ruby: string,
	word: string,
	description: string,
	source: string,
}

interface Game {
	time: number,
	title: string,
	id: string,
	maxMeanings: number,
	maxCoins: number,
	status: 'meaning' | 'betting',
	meanings: {
		user: string,
		text: string,
		comment: string,
	}[],
	bettings: {
		[user: string]: {
			choice: number,
			coins: number,
			comment: string,
		},
	},
	choices: Choice[],
	author: string,
}

interface State {
	games: Game[],
}

const mutex = new Mutex();

const wordsVersion = '201907260000';

class Oogiri {
	rtm: RTMClient;

	slack: WebClient;

	slackInteractions: any;

	state: State;

	loadDeferred: Deferred;

	previousTick: number;

	constructor({
		rtm,
		slack,
		slackInteractions,
	}: {
		rtm: RTMClient,
		slack: WebClient,
		slackInteractions: any,
	}) {
		this.rtm = rtm;
		this.slack = slack;
		this.slackInteractions = slackInteractions;
		this.loadDeferred = new Deferred();
		this.previousTick = 0;

		this.state = {
			games: [],
		};
	}

	// TODO: lock
	async initialize() {
		if (this.loadDeferred.isResolved) {
			return this.loadDeferred.promise;
		}

		const statePath = path.resolve(__dirname, 'state.json');
		const stateExists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
		if (stateExists) {
			const stateData = await fs.readFile(statePath);
			Object.assign(this.state, JSON.parse(stateData.toString()));
		}

		this.slackInteractions.action({
			type: 'dialog_submission',
			callbackId: 'oogiri_start_dialog',
		}, (payload: any, respond: any) => {
			mutex.runExclusive(() => (
				this.startOogiri({
					title: payload.submission.title,
					coins: payload.submission.coins,
					meanings: payload.submission.meanings,
					respond,
					user: payload.user.id,
				})
			));
		});

		this.loadDeferred.resolve();

		return this.loadDeferred.promise;
	}

	showStartDialog(triggerId: string) {
		if (this.state.games.length >= 3) {
			throw new Error('大喜利を同時に3つ以上開催することはできないよ:imp:');
		}

		return this.slack.dialog.open({
			trigger_id: triggerId,
			dialog: {
				callback_id: 'oogiri_start_dialog',
				title: '大喜利設定',
				submit_label: '開始する',
				notify_on_cancel: true,
				elements: [
					{
						type: 'text',
						label: 'タイトル',
						name: 'title',
						hint: '大喜利のタイトルを入力してください',
					},
					{
						type: 'select',
						label: '1人あたりの意味登録可能数',
						name: 'meanings',
						options: times(5, (index) => ({
							label: `${index + 1}個`,
							value: (index + 1).toString(),
						})),
					},
					{
						type: 'select',
						label: '1人あたりのBET可能枚数',
						name: 'coins',
						options: times(5, (index) => ({
							label: `${index + 1}枚`,
							value: (index + 1).toString(),
						})),
					},
				],
			},
		});
	}

	async startOogiri({title, meanings, coins, respond, user}: {title: string, meanings: string, coins: string, respond: any, user: string}) {
		if (this.state.games.length > 2) {
			respond({
				text: '大喜利を同時に3つ以上開催することはできないよ👿',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return;
		}

		const now = Date.now();
		const game: Game = {
			time: now,
			id: Math.floor(Math.random() * 10000000).toString(),
			title,
			maxMeanings: parseInt(meanings),
			maxCoins: parseInt(coins),
			status: 'meaning',
			meanings: [],
			bettings: Object.create(null),
			choices: [],
			author: user,
		};

		await this.setState({
			games: this.state.games.concat([game]),
		});

		await this.postMessage({
			text: '',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							大喜利を始めるよ～
							＊テーマ＊ ${title}
						`,
					},
					fields: [
						{
							type: 'mrkdwn',
							text: `＊意味登録可能数＊ ${game.maxMeanings}個`,
						},
						{
							type: 'mrkdwn',
							text: `＊BET可能枚数＊ ${game.maxMeanings}枚`,
						},
					],
					accessory: {
						type: 'button',
						text: {
							type: 'plain_text',
							text: '登録する',
						},
						value: game.id,
					},
				},
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							登録済み: なし
						`,
					},
					accessory: {
						type: 'button',
						text: {
							type: 'plain_text',
							text: '終了する',
						},
						value: 'end_meaning',
						style: 'danger',
						confirm: {
							text: {
								type: 'plain_text',
								text: '意味登録を終了しますか？',
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
					},
				},
			],
		});
	}


	async setState(object: Partial<State>) {
		Object.assign(this.state, object);
		const statePath = path.resolve(__dirname, 'state.json');
		await fs.writeFile(statePath, JSON.stringify(this.state));
	}

	// eslint-disable-next-line camelcase
	postMessage(message: {text: string, blocks?: KnownBlock[], unfurl_links?: true}) {
		return this.slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			...message,
		});
	}
}

export const server = ({webClient: slack, rtmClient: rtm, messageClient: slackInteractions}: SlackInterface) => plugin(async (fastify, opts, next) => {
	const oogiri = new Oogiri({slack, rtm, slackInteractions});
	await oogiri.initialize();

	fastify.post('/slash/oogiri', async (req, res) => {
		if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
			res.code(400);
			return 'Bad Request';
		}

		await oogiri.showStartDialog(req.body.trigger_id);
		return 'ok';
	});
});
