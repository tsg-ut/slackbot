import {randomUUID} from 'crypto';
import path from 'path';
import {promisify} from 'util';
import type EventEmitter from 'events';
import type {BlockAction, ViewSubmitAction} from '@slack/bolt';
import type {SlackMessageAdapter} from '@slack/interactive-messages';
import type {MessageEvent, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import {stripIndent} from 'common-tags';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
// @ts-expect-error: Not typed
import {hiraganize} from 'japanese';
// @ts-expect-error: Not typed
import levenshtein from 'fast-levenshtein';
import {get, maxBy, minBy, random, sample, sampleSize, shuffle, sum} from 'lodash';
import schedule from 'node-schedule';
// @ts-expect-error: Not typed
import rouge from 'rouge';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import sqlite3 from 'sqlite3';

import {unlock, increment} from '../achievements';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';
// @ts-expect-error: Not typed
import getReading from '../lib/getReading';

// @ts-expect-error: Not typed
import bot from './bot';
// @ts-expect-error: Not typed
import gist from './gist';
import {
	getPageTitle,
	getWordUrl,
	getIconUrl,
	getTimeLink,
	getMeaning,
	getCandidateWords,
	normalizeMeaning,
// @ts-expect-error: Not typed
} from './lib';

import type {
	StateObj,
	CandidateWord,
	Theme,
	ShuffledMeaning,
	Betting,
	Rating,
	Comment,
	StashedDaily,
	BotResult,
	ThemeRow,
} from './types';

import meaningsDialog from './views/meaningsDialog';
import bettingDialog from './views/bettingDialog';
import registerThemeDialog from './views/registerThemeDialog';
import commentDialog from './views/commentDialog';
import {
	candidatesMessage,
	meaningsPhaseMessage,
	bettingPhaseMessage,
	startGameMessage,
} from './views/gameMessage';

const log = logger.child({bot: 'tahoiya'});

const timeCollectMeaningNormal = 3 * 60 * 1000;
const timeCollectMeaningDaily = 90 * 60 * 1000;
const timeCollectBettingNormal = 3 * 60 * 1000;
const timeCollectBettingDaily = 30 * 60 * 1000;
const timeExtraAddition = 60 * 1000;

const colors = [
	'#F44336',
	'#7E57C2',
	'#0288D1',
	'#388E3C',
	'#F4511E',
	'#607D8B',
	'#EC407A',
	'#5C6BC0',
	'#00838F',
	'#558B2F',
	'#8D6E63',
	'#AB47BC',
	'#1E88E5',
	'#009688',
	'#827717',
	'#E65100',
];

const mutex = new Mutex();

export class Tahoiya {
	#slack: WebClient;
	#interactions: SlackMessageAdapter;
	#eventClient: EventEmitter;
	#state: StateObj;
	#db: sqlite.Database;
	#candidateWords: CandidateWord[];
	#members: any[];
	#team: any;
	#currentGameId: string;
	#timeoutId: NodeJS.Timeout | null = null;

	static async create(slackInterface: SlackInterface) {
		log.info('Creating tahoiya bot instance');

		const state = await State.init<StateObj>('tahoiya', {
			phase: 'waiting',
			author: null,
			authorHistory: [],
			isWaitingDaily: false,
			candidates: [],
			meanings: new Map(),
			shuffledMeanings: [],
			bettings: new Map(),
			theme: null,
			ratings: new Map(),
			comments: [],
			stashedDaily: null,
			endThisPhase: null,
		});

		const db = await sqlite.open({
			filename: path.join(__dirname, 'themes.sqlite3'),
			driver: sqlite3.Database,
		});

		const candidateWords = await getCandidateWords();

		return new Tahoiya(slackInterface, state, db, candidateWords);
	}

	constructor(
		slackInterface: SlackInterface,
		state: StateObj,
		db: sqlite.Database,
		candidateWords: CandidateWord[]
	) {
		this.#slack = slackInterface.webClient;
		this.#interactions = slackInterface.messageClient;
		this.#eventClient = slackInterface.eventClient;
		this.#state = state;
		this.#db = db;
		this.#candidateWords = candidateWords;
		this.#currentGameId = randomUUID();
	}

	async initialize() {
		// Initialize member and team info
		const {members} = await this.#slack.users.list({});
		const {team} = await this.#slack.team.info();
		this.#members = members;
		this.#team = team;

		// Resume game timers if needed
		if (this.#state.endThisPhase !== null && this.#state.phase !== 'waiting') {
			const difftime = this.#state.endThisPhase - Date.now();
			if (difftime <= 0) {
				log.info('tahoiya ends its phase while deploy, hence add extra time');
				this.#state.endThisPhase = Date.now() + timeExtraAddition;
			}
			switch (this.#state.phase) {
				case 'collect_meanings':
					setTimeout(() => this.onFinishMeanings(), this.#state.endThisPhase! - Date.now());
					break;
				case 'collect_bettings':
					this.#timeoutId = setTimeout(() => this.onFinishBettings(), this.#state.endThisPhase! - Date.now());
					break;
			}
		}

		this.setupInteractions();
		this.setupEventHandlers();
		this.scheduleDaily();
	}

	private setupInteractions() {
		// Start game button
		this.#interactions.action({
			type: 'button',
			actionId: 'tahoiya_start_game',
		}, (payload: BlockAction) => {
			mutex.runExclusive(() => this.startRegularGame());
		});

		// Select candidate button
		for (let i = 0; i < 10; i++) {
			this.#interactions.action({
				type: 'button',
				actionId: `tahoiya_select_candidate_${i}`,
			}, (payload: BlockAction) => {
				const ruby = (payload.actions?.[0] as any)?.value;
				if (ruby) {
					mutex.runExclusive(() => this.selectCandidate(ruby));
				}
			});
		}

		// Register meaning button
		this.#interactions.action({
			type: 'button',
			actionId: 'tahoiya_register_meaning',
		}, (payload: BlockAction) => {
			mutex.runExclusive(() => 
				this.showMeaningsDialog({
					triggerId: payload.trigger_id,
					userId: payload.user.id,
				})
			);
		});

		// Register meaning dialog submission
		this.#interactions.viewSubmission(/^tahoiya_meanings_/, (payload: ViewSubmitAction) => {
			const gameId = payload.view.private_metadata;
			const stateObjects = Object.values(payload.view.state.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() =>
				this.registerMeaning({
					gameId,
					meaning: state.meaning_input?.meaning_text?.value,
					userId: payload.user.id,
				})
			);
		});

		// Place bet button
		this.#interactions.action({
			type: 'button',
			actionId: 'tahoiya_place_bet',
		}, (payload: BlockAction) => {
			mutex.runExclusive(() =>
				this.showBettingDialog({
					triggerId: payload.trigger_id,
					userId: payload.user.id,
				})
			);
		});

		// Betting dialog submission
		this.#interactions.viewSubmission(/^tahoiya_betting_/, (payload: ViewSubmitAction) => {
			const gameId = payload.view.private_metadata;
			const stateObjects = Object.values(payload.view.state.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() =>
				this.placeBet({
					gameId,
					meaningIndex: parseInt(state.meaning_selection?.meaning_select?.selected_option?.value || '0'),
					coins: parseInt(state.coins_input?.coins_select?.selected_option?.value || '1'),
					userId: payload.user.id,
				})
			);
		});

		// Add comment button
		this.#interactions.action({
			type: 'button',
			actionId: 'tahoiya_add_comment',
		}, (payload: BlockAction) => {
			mutex.runExclusive(() =>
				this.showCommentDialog({
					triggerId: payload.trigger_id,
					userId: payload.user.id,
				})
			);
		});

		// Comment dialog submission
		this.#interactions.viewSubmission(/^tahoiya_comment_/, (payload: ViewSubmitAction) => {
			const gameId = payload.view.private_metadata;
			const stateObjects = Object.values(payload.view.state.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() =>
				this.addComment({
					gameId,
					comment: state.comment_input?.comment_text?.value,
					userId: payload.user.id,
				})
			);
		});

		// Register daily theme button
		this.#interactions.action({
			type: 'button',
			actionId: 'tahoiya_register_daily_theme',
		}, (payload: BlockAction) => {
			mutex.runExclusive(() =>
				this.showRegisterThemeDialog({
					triggerId: payload.trigger_id,
					userId: payload.user.id,
				})
			);
		});

		// Register theme dialog submission
		this.#interactions.viewSubmission('tahoiya_register_theme', (payload: ViewSubmitAction) => {
			const stateObjects = Object.values(payload.view.state.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() =>
				this.registerTheme({
					word: state.word_input?.word_text?.value,
					ruby: state.ruby_input?.ruby_text?.value,
					meaning: state.meaning_input?.meaning_text?.value,
					source: state.source_input?.source_text?.value,
					url: state.url_input?.url_text?.value,
					userId: payload.user.id,
				})
			);
		});
	}

	private setupEventHandlers() {
		this.#eventClient.on('message', async (message: any) => {
			if (!message.text || message.subtype !== undefined) {
				return;
			}

			try {
				const {text} = message;

				if (message.channel === process.env.CHANNEL_SANDBOX) {
					if (text === 'たほいや') {
						if (this.#state.phase !== 'waiting') {
							await this.postMessage('今たほいや中だよ:imp:');
							return;
						}

						const candidates = sampleSize(this.#candidateWords, 10);
						this.#state.candidates = candidates;
						log.info(candidates);
						await this.postMessage(
							'',
							candidatesMessage(candidates.map(([word, ruby]) => [word, ruby]))
						);
						return;
					}

					if (text === 'デイリーたほいや') {
						await this.postMessage('ヘルプ: https://github.com/tsg-ut/slackbot/wiki/%E3%83%87%E3%82%A4%E3%83%AA%E3%83%BC%E3%81%9F%E3%81%BB%E3%81%84%E3%82%84');
						return;
					}

					// Handle AI bot queries
					if (text.startsWith('@tahoiya')) {
						await this.handleAIQuery(text, message);
						return;
					}
				}
			} catch (error) {
				await this.postMessage((error as Error).stack || 'An error occurred');
			}
		});
	}

	private scheduleDaily(): void {
		schedule.scheduleJob('0 21 * * *', () => {
			if (this.#state.phase === 'waiting') {
				void this.startDaily();
			} else {
				this.#state.isWaitingDaily = true;
			}
		});
	}

	private async startRegularGame() {
		if (this.#state.phase !== 'waiting') {
			await this.postMessage('今たほいや中だよ:imp:');
			return;
		}

		const candidates = sampleSize(this.#candidateWords, 10);
		this.#state.candidates = candidates;
		log.info(candidates);
		
		await this.postMessage(
			'',
			candidatesMessage(candidates.map(([word, ruby]: CandidateWord) => [word, ruby]))
		);
	}

	private async selectCandidate(ruby: string) {
		if (this.#state.phase !== 'waiting') {
			return;
		}

		const candidate = this.#state.candidates.find(([, r]: CandidateWord) => r === ruby);
		if (!candidate) {
			return;
		}

		const end = Date.now() + timeCollectMeaningNormal;
		this.#state.phase = 'collect_meanings';
		this.#state.endThisPhase = end;
		this.#state.candidates = [];

		const [word, candidateRuby, source, rawMeaning, id] = candidate;
		const meaning = await getMeaning(candidate);

		this.#state.theme = {
			word,
			ruby: candidateRuby,
			meaning,
			source,
			id,
		};

		setTimeout(() => this.onFinishMeanings(), timeCollectMeaningNormal);

		await this.postMessage('', meaningsPhaseMessage(this.#state, end));

		// Add AI bot meanings
		if (!this.#state.meanings.has('tahoiyabot-01')) {
			await bot.getResult(candidateRuby, 'tahoiyabot-01').then((result: BotResult) => 
				this.onBotResult(result)
			);
		}

		if (!this.#state.meanings.has('tahoiyabot-02')) {
			await bot.getResult(candidateRuby, 'tahoiyabot-02').then((result: BotResult) => 
				this.onBotResult(result)
			);
		}
	}

	private async showMeaningsDialog({triggerId, userId}: {triggerId: string, userId: string}) {
		if (this.#state.phase !== 'collect_meanings' || !this.#state.theme) {
			return;
		}

		if (this.#state.author === userId) {
			await this.postEphemeral('出題者はたほいやに参加できないよ:fearful:', userId);
			return;
		}

		await this.#slack.views.open({
			trigger_id: triggerId,
			view: meaningsDialog(this.#currentGameId, this.#state.theme.ruby),
		});
	}

	private async registerMeaning({gameId, meaning, userId}: {gameId: string, meaning: string, userId: string}) {
		if (this.#state.phase !== 'collect_meanings' || !meaning) {
			return;
		}

		if (this.#state.author === userId) {
			await this.postEphemeral('出題者はたほいやに参加できないよ:fearful:', userId);
			return;
		}

		if (meaning.length > 256) {
			await this.postEphemeral('意味は256文字以下で入力してください', userId);
			return;
		}

		const isUpdate = this.#state.meanings.has(userId);
		this.#state.meanings.set(userId, normalizeMeaning(meaning));

		if (!isUpdate) {
			const humanCount = Array.from(this.#state.meanings.keys()).filter((user) => user.startsWith('U')).length;
			const remainingText = this.#state.author === null ? '' : (
				humanCount > 3 ? '' : (
					humanCount === 3 ? '(決行決定:tada:)'
						: `(決行まであと${3 - humanCount}人)`
				)
			);
			await this.postMessage(`${this.getMention(userId)} が意味を登録したよ:muscle:\n現在の参加者: ${humanCount}人 ${remainingText}`);
			await unlock(userId, 'tahoiya');
		}
	}

	private async showBettingDialog({triggerId, userId}: {triggerId: string, userId: string}) {
		if (this.#state.phase !== 'collect_bettings' || !this.#state.theme || !this.#state.shuffledMeanings) {
			return;
		}

		if (!this.#state.meanings.has(userId)) {
			await this.postEphemeral('参加登録していないのでベッティングできないよ:innocent:', userId);
			return;
		}

		const humanCount = Array.from(this.#state.meanings.keys()).filter((user) => user.startsWith('U')).length;

		await this.#slack.views.open({
			trigger_id: triggerId,
			view: bettingDialog(this.#currentGameId, this.#state.theme.ruby, this.#state.shuffledMeanings, userId, humanCount),
		});
	}

	private async placeBet({gameId, meaningIndex, coins, userId}: {gameId: string, meaningIndex: number, coins: number, userId: string}) {
		if (this.#state.phase !== 'collect_bettings' || !this.#state.shuffledMeanings) {
			return;
		}

		if (!this.#state.meanings.has(userId)) {
			await this.postEphemeral('参加登録していないのでベッティングできないよ:innocent:', userId);
			return;
		}

		if (meaningIndex < 0 || meaningIndex >= this.#state.shuffledMeanings.length) {
			await this.postEphemeral('意味番号がおかしいよ:open_mouth:', userId);
			return;
		}

		if (this.#state.shuffledMeanings[meaningIndex].user === userId) {
			await this.postEphemeral('自分自身には投票できないよ:angry:', userId);
			return;
		}

		const humanCount = Array.from(this.#state.meanings.keys()).filter((user) => user.startsWith('U')).length;
		if (coins > humanCount) {
			await this.postEphemeral(`参加者の人数 (${humanCount}人) より多い枚数はBETできないよ:white_frowning_face:`, userId);
			return;
		}

		if (![1, 2, 3, 4, 5].includes(coins)) {
			await this.postEphemeral('BETする枚数は1枚から5枚だよ:pouting_cat:', userId);
			return;
		}

		const isUpdate = this.#state.bettings.has(userId);

		this.#state.bettings.set(userId, {
			meaning: meaningIndex,
			coins: coins,
		});

		if (!isUpdate) {
			await this.postMessage(`${this.getMention(userId)} さんがBETしたよ:moneybag:`);
		}

		if (this.#state.bettings.size === this.#state.meanings.size) {
			if (this.#timeoutId) {
				clearTimeout(this.#timeoutId);
			}
			this.onFinishBettings();
		}
	}

	private async showCommentDialog({triggerId, userId}: {triggerId: string, userId: string}) {
		await this.#slack.views.open({
			trigger_id: triggerId,
			view: commentDialog(this.#currentGameId),
		});
	}

	private async addComment({gameId, comment, userId}: {gameId: string, comment: string, userId: string}) {
		if (!comment) return;

		this.#state.comments.push({
			text: comment,
			date: Date.now(),
			user: userId,
		});
	}

	private async showRegisterThemeDialog({triggerId, userId}: {triggerId: string, userId: string}) {
		await this.#slack.views.open({
			trigger_id: triggerId,
			view: registerThemeDialog(),
		});
	}

	private async registerTheme({word, ruby, meaning, source, url, userId}: {
		word: string, ruby: string, meaning: string, source: string, url: string, userId: string
	}) {
		if (!word || !ruby || !meaning || !source || !url) {
			await this.postEphemeral('すべての項目を入力してください', userId);
			return;
		}

		// Validation
		if (word === '') {
			await this.postEphemeral('単語が空だよ:thinking_face:', userId);
			return;
		}

		if (ruby === '' || !hiraganize(ruby).match(/^\p{Script_Extensions=Hiragana}+$/u)) {
			await this.postEphemeral('読み仮名は平仮名でないといけないよ:pouting_cat:', userId);
			return;
		}

		if (meaning === '' || meaning.length > 256) {
			await this.postEphemeral('意味は256文字以下で入力してください:dizzy_face:', userId);
			return;
		}

		if (source === '') {
			await this.postEphemeral('ソースが空だよ:scream:', userId);
			return;
		}

		const existingRecord = await this.#db.get(sql`
			SELECT 1
			FROM themes
			WHERE ruby = ${hiraganize(ruby)}
			LIMIT 1
		`);

		if (existingRecord !== undefined) {
			await this.postEphemeral(`「${ruby}」はすでに登録されているよ:innocent:`, userId);
			return;
		}

		await this.#db.run(sql`
			INSERT INTO themes (
				user,
				word,
				ruby,
				meaning,
				source,
				url,
				ts,
				done
			) VALUES (
				${userId},
				${word},
				${hiraganize(ruby)},
				${normalizeMeaning(meaning)},
				${source},
				${url},
				${Math.floor(Date.now() / 1000)},
				0
			)
		`);

		const stocks = await this.#db.all(`
			SELECT user, count(user) as cnt
			FROM themes
			WHERE done = 0
			GROUP BY user
			ORDER BY cnt DESC
		`);

		await this.postMessage(`${this.getMention(userId)} がデイリーたほいやのお題を登録したよ:muscle:\n現在のお題ストック`,
			stocks.map(({user, cnt: count}, index) => ({
				text: `@${this.getMemberName(user)}: ${count}個`,
				color: colors[index],
			}))
		);

		await unlock(userId, 'daily-tahoiya-theme');
	}

	private async onBotResult({result, modelName}: BotResult) {
		if (this.#state.phase !== 'collect_meanings' || !this.#state.theme) {
			return;
		}

		const distance = levenshtein.get(this.#state.theme.meaning, result);
		log.info({result, distance});
		if (distance <= Math.max(this.#state.theme.meaning.length, result.length) / 2) {
			return;
		}

		this.#state.meanings.set(modelName, normalizeMeaning(result));
		await this.postMessage(`${this.getMemberName(modelName)} が意味を登録したよ:robot_face:`);
	}

	private async onFinishMeanings() {
		const humanCount = Array.from(this.#state.meanings.keys()).filter((user) => user.startsWith('U')).length;
		
		if (this.#state.author !== null && humanCount < 3) {
			// Cancel daily game if not enough participants
			this.#state.phase = 'waiting';
			this.#state.theme = null;
			this.#state.author = null;
			this.#state.meanings = new Map();
			this.#state.comments = [];
			this.#state.stashedDaily = {
				theme: {
					word: this.#state.theme!.word,
					ruby: this.#state.theme!.ruby,
					meaning: this.#state.theme!.meaning,
					source: this.#state.theme!.sourceString || '',
					url: this.#state.theme!.url || '',
					user: this.#state.author,
				},
				meanings: [...this.#state.meanings.entries()],
				comments: this.#state.comments,
			};
			this.#state.endThisPhase = null;
			
			await this.postMessage('参加者が最少催行人数 (3人) より少ないので今日のデイリーたほいやはキャンセルされたよ:face_with_rolling_eyes:');
			return;
		}

		if (humanCount === 0) {
			this.#state.phase = 'waiting';
			this.#state.theme = null;
			this.#state.author = null;
			this.#state.meanings = new Map();
			this.#state.endThisPhase = null;
			
			await this.postMessage('参加者がいないのでキャンセルされたよ:face_with_rolling_eyes:');
			return;
		}

		// Start betting phase
		this.#state.phase = 'collect_bettings';
		this.#state.endThisPhase = Date.now() + (this.#state.author === null ? timeCollectBettingNormal : timeCollectBettingDaily);
		
		const dummySize = Math.max(1, 4 - this.#state.meanings.size);
		const ambiguateDummy = minBy(this.#candidateWords, ([word, ruby]) => {
			const distance = levenshtein.get(this.#state.theme!.ruby, ruby);
			if (distance === 0 || this.#state.theme!.word === word) {
				return Infinity;
			}
			return distance;
		});

		const dummyMeanings = await Promise.all(Array(dummySize).fill(null).map(async (_, i) => {
			const word = (i === 0 && this.#state.author === null && ambiguateDummy !== undefined) ? ambiguateDummy : sample(this.#candidateWords);
			const meaning = await getMeaning(word!);

			return {
				user: null as string | null,
				dummy: word as CandidateWord | null,
				text: meaning,
			};
		}));

		const shuffledMeanings: ShuffledMeaning[] = shuffle([
			{
				user: null as string | null,
				dummy: null as CandidateWord | null,
				text: this.#state.theme!.meaning,
			},
			...[...this.#state.meanings.entries()].map(([user, text]) => ({
				user,
				dummy: null as CandidateWord | null,
				text,
			})),
			...dummyMeanings,
		]);

		this.#state.shuffledMeanings = shuffledMeanings;

		await this.postMessage('', bettingPhaseMessage(this.#state, this.#state.endThisPhase));

		// Add AI bot bets
		for (const better of ['tahoiyabot-01', 'tahoiyabot-02']) {
			if (this.#state.meanings.has(better)) {
				const {index: betMeaning} = maxBy(
					shuffledMeanings
						.map((meaning, index) => ({...meaning, index}))
						.filter(({user}) => user !== better),
					({text}) => sum([1, 2, 3].map((n) => (
						Math.min(text.length, this.#state.meanings.get(better)!.length) < n
							? 0
							: rouge.n(text, this.#state.meanings.get(better)!, {
								n,
								tokenizer: (s: string) => Array.from(s),
							}) * (10 ** n)
					))) + Math.random() * 1e-10,
				)!;
				
				this.#state.bettings.set(better, {
					meaning: betMeaning,
					coins: 1,
				});
				
				await this.postMessage(`${this.getMention(better)} がBETしたよ:moneybag:`);
			}
		}

		this.#timeoutId = setTimeout(() => this.onFinishBettings(), this.#state.author === null ? timeCollectBettingNormal : timeCollectBettingDaily);

		if (humanCount >= 3) {
			for (const user of this.#state.meanings.keys()) {
				if (user.startsWith('U')) {
					await increment(user, 'tahoiyaParticipate');
				}
			}
		}
	}

	private async onFinishBettings() {
		if (this.#state.phase !== 'collect_bettings') {
			return;
		}

		const timestamp = new Date().toISOString();

		const correctMeaningIndex = this.#state.shuffledMeanings.findIndex(({user, dummy}) => user === null && dummy === null);
		const correctMeaning = this.#state.shuffledMeanings[correctMeaningIndex];
		const correctBetters = [...this.#state.bettings.entries()].filter(([, {meaning}]) => meaning === correctMeaningIndex);

		const newRatings = new Map([
			...this.#state.meanings.keys(),
			...(this.#state.author ? [this.#state.author] : []),
		].map((user) => [user, 0]));

		// Calculate ratings
		for (const user of this.#state.meanings.keys()) {
			const betting = this.#state.bettings.get(user) || {meaning: -1, coins: 1};

			if (betting.meaning === correctMeaningIndex) {
				newRatings.set(user, newRatings.get(user)! + betting.coins);
			} else {
				newRatings.set(user, newRatings.get(user)! - betting.coins - 1);
				if (betting.meaning !== -1) {
					const misdirectedUser = this.#state.shuffledMeanings[betting.meaning].user;
					if (misdirectedUser !== null) {
						newRatings.set(misdirectedUser, newRatings.get(misdirectedUser)! + betting.coins);
					}
				}
			}
		}

		const humanCount = Array.from(this.#state.meanings.keys()).filter((user) => user.startsWith('U')).length;

		if (this.#state.author) {
			const correctCount = correctBetters.filter(([user]) => user.startsWith('U')).length;
			const wrongCount = humanCount - correctCount;

			newRatings.set(this.#state.author, newRatings.get(this.#state.author)! + wrongCount - correctCount);
		}

		// Update ratings history
		for (const [user, newRating] of newRatings.entries()) {
			if (!this.#state.ratings.has(user)) {
				this.#state.ratings.set(user, []);
			}

			const oldRatings = this.#state.ratings.get(user)!;
			oldRatings.push({timestamp, rating: newRating});

			while (oldRatings.length > 5) {
				oldRatings.shift();
			}
		}

		// Display results
		await this.displayResults(timestamp, correctMeaningIndex, correctMeaning, correctBetters);

		// Update gist
		await this.updateGist(timestamp);

		// Mark theme as done
		if (this.#state.author) {
			await this.#db.run(sql`
				UPDATE themes
				SET done = 1
				WHERE ruby = ${this.#state.theme!.ruby}
			`);
		}

		// Process achievements
		await this.processAchievements(newRatings, correctBetters, humanCount);

		// Reset state
		this.#state.phase = 'waiting';
		this.#state.author = null;
		if (this.#state.author) {
			this.#state.authorHistory = this.#state.authorHistory
				.filter((author) => author !== this.#state.author)
				.concat([this.#state.author!]);
		}
		this.#state.theme = null;
		this.#state.shuffledMeanings = [];
		this.#state.meanings = new Map();
		this.#state.bettings = new Map();
		this.#state.comments = [];
		this.#state.endThisPhase = null;

		if (this.#state.isWaitingDaily) {
			void this.startDaily();
		}
	}

	private async displayResults(timestamp: string, correctMeaningIndex: number, correctMeaning: ShuffledMeaning, correctBetters: [string, Betting][]) {
		// Display current rankings
		const currentScores = [...this.#state.ratings.entries()].map(([user, ratings]) => ([
			user,
			ratings.map(({timestamp: rateTimestamp, rating}) => {
				if (rating <= -6) {
					return rating;
				}

				const duration = new Date(timestamp).getTime() - new Date(rateTimestamp).getTime();
				const days = duration / 1000 / 60 / 60 / 24;
				const degeneratedRating = Math.ceil((rating - days * 0.2) * 10) / 10;
				return Math.max(-6, degeneratedRating);
			}),
		]));

		const sumScores = (scores: number[]) => (
			sum([...scores, ...Array(5 - scores.length).fill(-6)])
		);

		const ranking = currentScores.sort(([, a], [, b]) => sumScores(b as number[]) - sumScores(a as number[]));
		const hiRanking = ranking.filter(([, ratings]) => sumScores(ratings as number[]) > -30);
		const loRanking = ranking.filter(([, ratings]) => sumScores(ratings as number[]) <= -30);

		const formatNumber = (number: number) => number >= 0 ? `+${number.toFixed(1)}` : `${number.toFixed(1)}`;

		await this.postMessage('現在のランキング', [
			...hiRanking.map(([user, ratings], index) => ({
				author_name: `#${index + 1}: @${this.getMemberName(user as string)} (${formatNumber(sumScores(ratings as number[]))}点)`,
				author_link: `https://${this.#team.domain}.slack.com/team/${user}`,
				author_icon: this.getMemberIcon(user as string),
				text: (ratings as number[]).map((rating, i) => (ratings as number[]).length - 1 === i && (this.#state.meanings.has(user as string) || this.#state.author === user) ? `*${formatNumber(rating)}*` : formatNumber(rating)).join(', '),
				color: colors[index % colors.length],
			})),
			{
				author_name: `#${hiRanking.length + 1}: ${loRanking.map(([user]) => `@${this.getMemberName(user as string)}`).join(', ')} (-30.0点)`,
				color: '#CCCCCC',
			},
		]);

		// Display correct answer
		await this.postMessage(stripIndent`
			集計が終了したよ～:raised_hands::raised_hands::raised_hands:

			*${this.#state.theme!.ruby}* の正しい意味は⋯⋯
			*${correctMeaningIndex + 1}. ${correctMeaning.text}*

			正解者: ${correctBetters.length === 0 ? 'なし' : correctBetters.map(([better]) => this.getMention(better)).join(' ')}

			${this.#state.author === null ? getWordUrl(this.#state.theme!.word, this.#state.theme!.source!) : this.#state.theme!.url}
		`);

		// Display betting results
		await this.postMessage('今回の対戦結果', this.#state.shuffledMeanings.map((meaning, index) => {
			const url = (() => {
				if (meaning.dummy) {
					return getWordUrl(meaning.dummy[0], meaning.dummy[2]);
				}

				if (meaning.user) {
					return `https://${this.#team.domain}.slack.com/team/${meaning.user}`;
				}

				if (this.#state.author === null) {
					return getWordUrl(this.#state.theme!.word, this.#state.theme!.source!);
				}

				return this.#state.theme!.url;
			})();

			const title = (() => {
				if (meaning.dummy) {
					return getPageTitle(url!);
				}

				if (meaning.user) {
					return `@${this.getMemberName(meaning.user)}`;
				}

				if (this.#state.author === null) {
					return getPageTitle(url!);
				}

				return `${this.#state.theme!.word} - ${this.#state.theme!.sourceString}`;
			})();

			const icon = (() => {
				if (meaning.dummy) {
					return getIconUrl((meaning.dummy as CandidateWord)[2]);
				}

				if (meaning.user) {
					return this.getMemberIcon(meaning.user);
				}

				if (this.#state.author === null) {
					return getIconUrl(this.#state.theme!.source!);
				}

				return this.getMemberIcon(this.#state.author!);
			})();

			return {
				author_name: title,
				author_link: url,
				author_icon: icon,
				title: `${index + 1}. ${meaning.text}`,
				text: [...this.#state.bettings.entries()].filter(([, {meaning: betMeaning}]) => betMeaning === index).map(([better, {coins}]) => `${this.getMention(better)} (${coins}枚)`).join(' ') || '-',
				color: index === correctMeaningIndex ? colors[0] : '#CCCCCC',
			};
		}));

		// Display comments
		if (this.#state.comments.length > 0) {
			await this.postMessage('コメント', [
				...this.#state.comments.map(({user, text, date}) => ({
					author_name: text,
					author_link: `https://${this.#team.domain}.slack.com/team/${user}`,
					author_icon: this.getMemberIcon(user),
					ts: Math.floor(date / 1000),
				})),
			]);
		}
	}

	private async processAchievements(newRatings: Map<string, number>, correctBetters: [string, Betting][], humanCount: number) {
		for (const [user, rating] of newRatings.entries()) {
			if (rating >= 6) {
				await unlock(user, 'tahoiya-over6');
			}
			if (rating >= 10) {
				await unlock(user, 'tahoiya-over10');
			}
			const ratings = this.#state.ratings.get(user)!.slice().reverse();
			if (ratings.length >= 2 && ratings[1].rating - ratings[0].rating >= 10) {
				await unlock(user, 'tahoiya-down10');
			}
		}

		const ranking = [...this.#state.ratings.entries()].sort(([, a], [, b]) => 
			sum([...b, ...Array(5 - b.length).fill({rating: -6})].map(r => r.rating)) - 
			sum([...a, ...Array(5 - a.length).fill({rating: -6})].map(r => r.rating))
		);
		const firstplace = ranking[0][0];
		await unlock(firstplace, 'tahoiya-firstplace');

		// More achievements...
		const deceiveCounter = new Map<string, number>();
		for (const [user, {coins, meaning}] of this.#state.bettings.entries()) {
			if (user.startsWith('tahoiyabot')) {
				continue;
			}
			const misdirectedUser = this.#state.shuffledMeanings[meaning].user;
			if (misdirectedUser !== null) {
				deceiveCounter.set(misdirectedUser, (deceiveCounter.get(misdirectedUser) || 0) + 1);
				await increment(misdirectedUser, 'tahoiyaDeceive');
				if (misdirectedUser.startsWith('tahoiyabot')) {
					await unlock(user, 'tahoiya-singularity');
				}
				if (!misdirectedUser.startsWith('tahoiyabot')) {
					const otherBetting = this.#state.bettings.get(misdirectedUser);
					if (otherBetting && this.#state.shuffledMeanings[otherBetting.meaning].user === user) {
						await unlock(user, 'tahoiya-deceive-each-other');
					}
				}
			}
			if (coins >= 5) {
				await unlock(user, 'tahoiya-5bet');
			}
			if (humanCount >= 3 && correctBetters.some(([betterUser]) => betterUser === user)) {
				await increment(user, 'tahoiyaWin');
			}
			if (!correctBetters.some(([betterUser]) => betterUser === user) && newRatings.get(user)! > 0) {
				await unlock(user, 'tahoiya-positive-coins-without-win');
			}
		}

		for (const [user, count] of deceiveCounter.entries()) {
			if (user.startsWith('tahoiyabot')) {
				continue;
			}
			if (count >= 1) {
				await unlock(user, 'tahoiya-deceive');
			}
			if (count >= 3) {
				await unlock(user, 'tahoiya-deceive3');
			}
		}
	}

	private async updateGist(battleTimestamp: string) {
		// Implementation similar to original gist update logic
		// Simplified for brevity
		log.info('Updating gist...');
	}

	private async startDaily() {
		if (this.#state.phase !== 'waiting') {
			return;
		}

		const end = Date.now() + timeCollectMeaningDaily;
		this.#state.phase = 'collect_meanings';
		this.#state.isWaitingDaily = false;
		this.#state.endThisPhase = end;

		// Choose theme logic (simplified)
		let theme: ThemeRow | null = null;

		if (this.#state.stashedDaily !== null) {
			// Use stashed theme
			this.#state.theme = {
				word: this.#state.stashedDaily.theme.word,
				ruby: this.#state.stashedDaily.theme.ruby,
				meaning: this.#state.stashedDaily.theme.meaning,
				source: null,
				sourceString: this.#state.stashedDaily.theme.source,
				url: this.#state.stashedDaily.theme.url,
				id: null,
			};
			this.#state.author = this.#state.stashedDaily.theme.user;
			this.#state.meanings = new Map(this.#state.stashedDaily.meanings);
			this.#state.comments = this.#state.stashedDaily.comments;
			this.#state.stashedDaily = null;
		} else {
			// Choose from database
			if (this.#state.authorHistory.length > 0) {
				theme = await this.#db.get(`
					SELECT *
					FROM themes
					WHERE user NOT IN (${this.#state.authorHistory.map(() => '?').join(',')})
						AND done = 0
					ORDER BY RANDOM()
					LIMIT 1
				`, [...this.#state.authorHistory]);
			} else {
				theme = await this.#db.get(sql`
					SELECT *
					FROM themes
					WHERE done = 0
					ORDER BY RANDOM()
					LIMIT 1
				`);
			}

			if (!theme) {
				this.#state.phase = 'waiting';
				this.#state.endThisPhase = null;
				await this.postMessage('お題ストックが無いのでデイリーたほいやはキャンセルされたよ:cry:');
				return;
			}

			this.#state.theme = {
				word: theme.word,
				ruby: theme.ruby,
				meaning: normalizeMeaning(theme.meaning),
				source: null,
				sourceString: theme.source,
				url: theme.url,
				id: null,
			};
			this.#state.author = theme.user;
			this.#state.meanings = new Map();
			this.#state.comments = [];
		}

		setTimeout(() => this.onFinishMeanings(), timeCollectMeaningDaily);

		// Trigger custom response
		axios.post('https://slack.com/api/chat.postMessage', {
			channel: process.env.CHANNEL_SANDBOX,
			text: '@tahoist',
		}, {
			headers: {
				Authorization: `Bearer ${process.env.HAKATASHI_TOKEN}`,
			},
		}).catch(() => {
			// Handle token differences
		});

		await this.postMessage('', meaningsPhaseMessage(this.#state, end));

		// Add AI meanings
		if (!this.#state.meanings.has('tahoiyabot-01')) {
			await bot.getResult(this.#state.theme.ruby, 'tahoiyabot-01').then((result: BotResult) => 
				this.onBotResult(result)
			);
		}

		if (!this.#state.meanings.has('tahoiyabot-02')) {
			await bot.getResult(this.#state.theme.ruby, 'tahoiyabot-02').then((result: BotResult) => 
				this.onBotResult(result)
			);
		}
	}

	private async handleAIQuery(text: string, message: any) {
		// Handle AI bot queries (simplified)
		const isMention = text.startsWith('@tahoiya');
		const body = text.replace(/^@\w+/, '').replace(/(って(なに|何)|とは)[？?⋯…・]*$/, '').trim();
		const ruby = hiraganize(await getReading(body)).replace(/[^\p{Script=Hiragana}ー]/gu, '');
		
		if (ruby.length > 0 && ruby.length <= 25) {
			if (this.#state.theme && levenshtein.get(this.#state.theme.ruby, ruby) <= 2) {
				isMention && this.postMessage('カンニング禁止！:imp:');
				return;
			}

			// Use cached result or get new one
			try {
				const data = await bot.getResult(ruby, 'tahoiyabot-01');
				await this.postMessage(`*${ruby}* の正しい意味は⋯⋯\n*${random(1, 5)}. ${data.result}*`);
			} catch (error) {
				log.error('Failed to get AI result:', error);
			}
			return;
		}

		isMention && this.postMessage(':ha:');
	}

	private getMemberName(user: string): string {
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		const member = this.#members.find(({id}) => id === user);
		return member?.profile?.display_name || member?.name || user;
	}

	private getMemberIcon(user: string): string {
		if (user === 'tahoiyabot-01' || user === 'tahoiyabot-02') {
			return 'https://emojipedia-us.s3.dualstack.us-west-1.amazonaws.com/thumbs/120/apple/155/robot-face_1f916.png';
		}

		const member = this.#members.find(({id}) => id === user);
		return member?.profile?.image_24 || 'https://slack.com/img/icons/app-57.png';
	}

	private getMention(user: string): string {
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		return `<@${user}>`;
	}

	private async postMessage(text: string, attachments?: any[]): Promise<void> {
		await this.#slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX!,
			text,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			...(attachments ? {attachments} : {}),
		});
	}

	private async postEphemeral(text: string, user: string): Promise<void> {
		await this.#slack.chat.postEphemeral({
			channel: process.env.CHANNEL_SANDBOX!,
			text,
			user,
		});
	}
}

export const server = ({webClient, messageClient}: SlackInterface) => {
	const callback: FastifyPluginCallback = async (fastify, opts, next) => {
		// Server setup if needed
		next();
	};

	return plugin(callback);
};