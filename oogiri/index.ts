import {constants, promises as fs} from 'fs';
// @ts-ignore
import download from 'download';
import path from 'path';
import {KnownBlock, MrkdwnElement, PlainTextElement, RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import {Mutex} from 'async-mutex';
import {range, uniq, chunk, flatten, isEmpty, sampleSize, size, minBy, times, sample, shuffle, map} from 'lodash';
// @ts-ignore
import {stripIndent} from 'common-tags';
// @ts-ignore
import levenshtein from 'fast-levenshtein';
import {Deferred} from '../lib/utils';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import plugin from 'fastify-plugin';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	messageClient: any,
}

interface Meaning {
	user: string,
	text: string,
}

interface Game {
	time: number,
	title: string,
	id: string,
	maxMeanings: number,
	maxCoins: number,
	status: 'meaning' | 'betting',
	meanings: Meaning[],
	bettings: {
		[user: string]: {
			choice: number,
			coins: number,
		},
	},
	choices: Meaning[],
	author: string,
}

interface State {
	games: Game[],
}

const mutex = new Mutex();

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

		this.slackInteractions.action({
			type: 'button',
			blockId: 'oogiri_add_meaning',
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;
			mutex.runExclusive(() => (
				this.showMeaningDialog({
					triggerId: payload.trigger_id,
					user: payload.user.id,
					id: action.value,
					respond,
				})
			));
		});

		this.slackInteractions.action({
			type: 'dialog_submission',
			callbackId: 'oogiri_add_meaning_dialog',
		}, (payload: any, respond: any) => {
			mutex.runExclusive(() => (
				this.registerMeaning({
					id: payload.state,
					meanings: Object.entries(payload.submission).filter(([key]) => key.startsWith('meaning')).map(([, meaning]) => meaning as string),
					user: payload.user.id,
					respond,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			blockId: 'oogiri_end_meaning',
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;
			mutex.runExclusive(() => (
				this.finishMeaning(action.value)
			));
		});

		this.slackInteractions.action({
			type: 'button',
			blockId: /^oogiri_betting/,
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;
			const [id, choiceText] = action.value.split(',');
			const choice = parseInt(choiceText);
			mutex.runExclusive(() => (
				this.showBettingDialog({
					triggerId: payload.trigger_id,
					id,
					choice: Number.isNaN(choice) ? null : choice,
					user: payload.user.id,
					respond,
				})
			));
		});

		this.slackInteractions.action({
			type: 'dialog_submission',
			callbackId: 'oogiri_add_betting_dialog',
		}, (payload: any, respond: any) => {
			mutex.runExclusive(() => (
				this.registerBetting({
					id: payload.state,
					choice: payload.submission.choice,
					coins: payload.submission.coins,
					user: payload.user.id,
					respond,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			blockId: 'oogiri_end_betting',
		}, (payload: any, respond: any) => {
			const [action] = payload.actions;
			mutex.runExclusive(() => (
				this.finishBetting(action.value)
			));
		});

		this.loadDeferred.resolve();

		return this.loadDeferred.promise;
	}

	showStartDialog(triggerId: string) {
		if (this.state.games.length >= 3) {
			return '大喜利を同時に3つ以上開催することはできないよ:imp:';
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
					block_id: 'oogiri_add_meaning',
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
					block_id: 'oogiri_end_meaning',
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
						value: game.id,
						style: 'danger',
						confirm: {
							text: {
								type: 'plain_text',
								text: `大喜利「${game.title}」の意味登録を締め切りますか？`,
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

	showMeaningDialog({triggerId, id, user, respond}: {triggerId: string, id: string, user: string, respond: any}) {
		const game = this.state.games.find((g) => g.id === id);
		if (!game) {
			respond({
				text: 'Error: Game not found',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		const meanings = game.meanings.filter((meaning) => meaning.user === user);

		return this.slack.dialog.open({
			trigger_id: triggerId,
			dialog: {
				callback_id: 'oogiri_add_meaning_dialog',
				title: '大喜利意味登録',
				submit_label: '登録する',
				notify_on_cancel: true,
				state: game.id,
				elements: [
					{
						type: 'text',
						label: game.title,
						name: 'meaning1',
						min_length: 3,
						value: meanings[0] ? meanings[0].text : '',
						hint: '後から変更できます',
					},
					...(range(game.maxMeanings - 1).map((i) => ({
						type: 'text' as ('text'),
						label: `${i + 2}個目`,
						name: `meaning${i + 2}`,
						min_length: 3,
						value: meanings[i + 1] ? meanings[i + 1].text : '',
						hint: '後から変更できます',
						optional: true,
					}))),
				],
			},
		});
	}

	async registerMeaning({
		id,
		meanings,
		user,
		respond,
	}: {
		id: string,
		meanings: string[],
		user: string,
		respond: any,
	}): Promise<void> {
		const game = this.state.games.find((g) => g.id === id);
		if (!game) {
			respond({
				text: 'この大喜利の意味登録は終了しているよ😢',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		game.meanings = game.meanings.filter((meaning) => meaning.user !== user).concat(meanings.filter((meaning) => meaning).map((text) => ({user, text})))
		await this.setState({
			games: this.state.games,
		});

		const count = uniq(game.meanings.map((m) => m.user)).length;

		await this.postMessage({
			text: stripIndent`
				<@${user}>が意味を登録したよ💪
				現在の参加者: ${count}人
			`,
		});

		return;
	}

	async finishMeaning(id: string) {
		const game = this.state.games.find((g) => g.id === id);

		if (isEmpty(game.meanings)) {
			await this.setState({
				games: this.state.games.filter((g) => g !== game),
			});
			await this.postMessage({
				text: stripIndent`
					大喜利「${game.title}」は参加者がいないのでキャンセルされたよ🙄
				`,
			});
			return;
		}

		game.status = 'betting';
		await this.setState({games: this.state.games});

		const shuffledMeanings = shuffle(game.meanings);

		// eslint-disable-next-line require-atomic-updates
		game.choices = shuffledMeanings;

		await this.setState({games: this.state.games});
		const mentions = uniq(game.meanings.map((meaning) => `<@${meaning.user}>`));

		await this.postMessage({
			text: '',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							${mentions.join(' ')}
							ベッティングタイムが始まるよ～👐👐👐
						`,
					},
				} as KnownBlock,
				...shuffledMeanings.map((meaning, index) => ({
					type: 'section',
					block_id: `oogiri_betting_${index}`,
					text: {
						type: 'mrkdwn',
						text: `${index + 1}. ＊${meaning.text}＊`,
					},
					accessory: {
						type: 'button',
						text: {
							type: 'plain_text',
							text: `${index + 1}にBETする`,
						},
						value: [game.id, index].join(','),
					},
				} as KnownBlock)),
				{
					type: 'section',
					block_id: 'oogiri_end_betting',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							BET済み: なし
						`,
					},
					accessory: {
						type: 'button',
						text: {
							type: 'plain_text',
							text: '終了する',
						},
						value: game.id,
						style: 'danger',
						confirm: {
							text: {
								type: 'plain_text',
								text: `大喜利「${game.title}」のベッティングを締め切りますか？`,
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

	showBettingDialog({
		triggerId,
		id,
		choice,
		user,
		respond,
	}: {
		triggerId: string,
		id: string,
		choice: number | null,
		user: string,
		respond: any,
	}) {
		const game = this.state.games.find((g) => g.id === id);
		if (!game) {
			respond({
				text: 'Error: Game not found',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		const coins = game.bettings[user] ? game.bettings[user].coins : 1;

		return this.slack.dialog.open({
			trigger_id: triggerId,
			dialog: {
				callback_id: 'oogiri_add_betting_dialog',
				title: '大喜利BET',
				submit_label: 'BETする',
				notify_on_cancel: true,
				state: id,
				elements: [
					{
						type: 'select',
						label: 'BETする意味',
						name: 'choice',
						...(choice === null ? {} : {value: choice.toString()}),
						hint: '後から変更できます',
						options: game.choices.map(({text}, index) => ({
							label: `${index + 1}. ${text}`,
							value: index.toString(),
						})),
					},
					{
						type: 'select',
						label: 'BETする枚数',
						name: 'coins',
						value: coins.toString(),
						hint: '後から変更できます',
						options: times(game.maxCoins, (index) => ({
							label: `${index + 1}枚`,
							value: (index + 1).toString(),
						})),
					},
				],
			},
		});
	}

	async registerBetting({
		id,
		choice,
		coins,
		user,
		respond,
	}: {
		id: string,
		choice: string,
		coins: string,
		user: string,
		respond: any,
	}): Promise<void> {
		const game = this.state.games.find((g) => g.id === id);
		if (!game || game.status !== 'betting') {
			respond({
				text: 'この大喜利の投票は終了しているよ😢',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		const choiceMeaning = game.choices[parseInt(choice)];

		if (choiceMeaning && choiceMeaning.user === user) {
			respond({
				text: '自分自身には投票できないよ',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		game.bettings[user] = {
			choice: parseInt(choice),
			coins: parseInt(coins),
		};

		await this.setState({
			games: this.state.games,
		});

		await this.postMessage({
			text: stripIndent`
				<@${user}>が投票したよ💰
			`,
		});

		return;
	}

	async finishBetting(id: string) {
		const game = this.state.games.find((g) => g.id === id);

		await this.postMessage({
			text: '',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							結果発表～～
							＊テーマ＊ ${game.title}
						`,
					},
				} as KnownBlock,
				...game.choices.map((meaning, index) => ({
					type: 'section',
					block_id: `oogiri_betting_${index}`,
					text: {
						type: 'mrkdwn',
						text: stripIndent`
							<@${meaning.user}>
							${index + 1}. ＊${meaning.text}＊
							投票: ${Object.entries(game.bettings).filter(([, betting]) => betting.choice === index).map(([user, betting]) => (
								`<@${user}> (${betting.coins}枚)`
							)).join('、')}
						`,
					},
				} as KnownBlock)),
			],
		});

		await this.setState({
			games: this.state.games.filter((g) => g !== game),
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

		return oogiri.showStartDialog(req.body.trigger_id);
	});
});
