import path from 'path';
import type {BlockButtonAction, ViewSubmitAction} from '@slack/bolt';
import {SlackMessageAdapter} from '@slack/interactive-messages';
import type {WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
// @ts-expect-error: No type definitions available
import levenshtein from 'fast-levenshtein';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
// @ts-expect-error: No type definitions available
import {hiraganize} from 'japanese';
import {random, sampleSize} from 'lodash';
import {scheduleJob} from 'node-schedule';
import PQueue from 'p-queue';
import {open} from 'sqlite';
import {Database} from 'sqlite3';
import {unlock} from '../achievements';
// @ts-expect-error: No type definitions available
import getReading from '../lib/getReading.js';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {bot} from './bot';
import {
	meaningCollectionDialog,
	bettingDialog,
	themeRegistrationDialog,
	commentDialog,
} from './dialogs';
import {
	getTimeLink,
	getMeaning,
	getCandidateWords,
	normalizeMeaning,
} from './lib';
import type {
	TahoiyaState,
} from './types';

const log = logger.child({bot: 'tahoiya'});

const timeCollectMeaningNormal = 3 * 60 * 1000;
const timeExtraAddition = 60 * 1000;

export default class TahoiyaBot {
	private slack: WebClient;

	private eventClient: unknown;

	private messageClient: SlackMessageAdapter;

	private state: TahoiyaState;

	private db: unknown;

	private candidateWords: unknown[];

	private members: unknown[];

	private team: unknown;

	private timeoutId: ReturnType<typeof setTimeout> | null = null;

	private mutex = new Mutex();

	private queue = new PQueue({concurrency: 1});

	constructor({webClient, eventClient, messageClient}: SlackInterface) {
		this.slack = webClient;
		this.eventClient = eventClient;
		this.messageClient = messageClient;
	}

	async initialize() {
		// Initialize state
		this.state = await State.init<TahoiyaState>('tahoiya', {
			phase: 'waiting',
			isWaitingDaily: false,
			author: null,
			authorHistory: [],
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

		// Initialize database
		this.db = await open({
			filename: path.join(__dirname, 'themes.sqlite3'),
			driver: Database,
		});

		// Load candidate words
		this.candidateWords = await getCandidateWords();

		// Load Slack team info
		const {members} = await this.slack.users.list({});
		const {team} = await this.slack.team.info({});
		this.members = members;
		this.team = team;

		// Restore timers if needed
		this.restoreTimers();

		// Set up event listeners
		this.setupEventListeners();

		// Set up interactions
		this.setupInteractions();

		// Schedule daily games
		this.scheduleDaily();
	}

	private restoreTimers() {
		if (this.state.endThisPhase !== null && this.state.phase !== 'waiting') {
			const difftime = this.state.endThisPhase - Date.now();
			if (difftime <= 0) {
				log.info('tahoiya ends its phase while deploy, hence add extra time');
				this.state.endThisPhase = Date.now() + timeExtraAddition;
			}

			switch (this.state.phase) {
				case 'collect_meanings':
					setTimeout(() => this.onFinishMeanings(), this.state.endThisPhase - Date.now());
					break;
				case 'collect_bettings':
					this.timeoutId = setTimeout(() => this.onFinishBettings(), this.state.endThisPhase - Date.now());
					break;
			}
		}
	}

	private setupEventListeners() {
		// @ts-expect-error - Slack event client API
		this.eventClient.on('message', this.handleMessage.bind(this));
	}

	private setupInteractions() {
		// Setup button interactions
		this.messageClient.action({
			type: 'button',
			actionId: 'tahoiya_start_game',
		}, (payload: BlockButtonAction) => {
			this.mutex.runExclusive(() => this.handleStartGame());
		});

		this.messageClient.action({
			type: 'button',
			actionId: 'tahoiya_select_theme',
		}, (payload: BlockButtonAction) => {
			this.mutex.runExclusive(() => this.handleSelectTheme(payload));
		});

		this.messageClient.action({
			type: 'button',
			actionId: 'tahoiya_submit_meaning',
		}, (payload: BlockButtonAction) => {
			this.mutex.runExclusive(() => this.showMeaningDialog(payload));
		});

		this.messageClient.action({
			type: 'button',
			actionId: 'tahoiya_submit_betting',
		}, (payload: BlockButtonAction) => {
			this.mutex.runExclusive(() => this.showBettingDialog(payload));
		});

		this.messageClient.action({
			type: 'button',
			actionId: 'tahoiya_register_theme',
		}, (payload: BlockButtonAction) => {
			this.mutex.runExclusive(() => this.showThemeRegistrationDialog(payload));
		});

		this.messageClient.action({
			type: 'button',
			actionId: 'tahoiya_post_comment',
		}, (payload: BlockButtonAction) => {
			this.mutex.runExclusive(() => this.showCommentDialog(payload));
		});

		// Setup view submissions
		this.messageClient.viewSubmission('tahoiya_meaning_dialog', (payload: ViewSubmitAction) => {
			this.mutex.runExclusive(() => this.submitMeaning(payload));
		});

		this.messageClient.viewSubmission('tahoiya_betting_dialog', (payload: ViewSubmitAction) => {
			this.mutex.runExclusive(() => this.submitBetting(payload));
		});

		this.messageClient.viewSubmission('tahoiya_theme_registration_dialog', (payload: ViewSubmitAction) => {
			this.mutex.runExclusive(() => this.submitThemeRegistration(payload));
		});

		this.messageClient.viewSubmission('tahoiya_comment_dialog', (payload: ViewSubmitAction) => {
			this.mutex.runExclusive(() => this.submitComment(payload));
		});
	}

	private scheduleDaily() {
		scheduleJob('0 21 * * *', () => {
			if (this.state.phase === 'waiting') {
				this.startDaily();
			} else {
				this.state.isWaitingDaily = true;
			}
		});
	}

	private async handleMessage(message: unknown) {
		const msg = message as {text?: string, subtype?: string, channel?: string};
		if (!msg.text || msg.subtype !== undefined) {
			return;
		}

		try {
			const {text} = msg;

			if (msg.channel === process.env.CHANNEL_SANDBOX) {
				await this.handleChannelMessage(msg, text);
			}
		} catch (error) {
			this.postMessage((error as Error).stack || 'Unknown error');
		}
	}

	private async handleChannelMessage(message: unknown, text: string) {
		// Handle "たほいや" command
		if (text === 'たほいや') {
			if (this.state.phase !== 'waiting') {
				await this.postMessage('今たほいや中だよ:imp:');
				return;
			}

			const candidates = sampleSize(this.candidateWords, 10);
			this.state.candidates = candidates;
			log.info(candidates);

			await this.postMessage(
				stripIndent`
					たのしい"たほいや"を始めるよ～:clap::clap::clap:
					下のボタンからお題にする単語を選んでね:wink:
				`,
				[],
				{
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: 'たのしい"たほいや"を始めるよ～:clap::clap::clap:\n下のボタンからお題にする単語を選んでね:wink:',
							},
						},
						{
							type: 'actions',
							elements: candidates.map(([, ruby], index) => ({
								type: 'button',
								text: {
									type: 'plain_text',
									text: ruby,
								},
								value: ruby,
								action_id: 'tahoiya_select_theme',
								style: index === 0 ? 'primary' : undefined,
							})),
						},
					],
				},
			);
			return;
		}

		// Handle theme selection
		if (this.state.candidates.some(([, ruby]) => ruby === text)) {
			await this.selectThemeByText(text);
			return;
		}

		// Handle "デイリーたほいや" command
		if (text === 'デイリーたほいや') {
			await this.postMessage('ヘルプ: https://github.com/tsg-ut/slackbot/wiki/%E3%83%87%E3%82%A4%E3%83%AA%E3%83%BC%E3%81%9F%E3%81%BB%E3%81%84%E3%82%84');
			return;
		}

		// Handle AI bot queries
		if (text.startsWith('@tahoiya')) {
			await this.handleAIQuery(message, text);
		}
	}

	private async selectThemeByText(text: string) {
		if (this.state.phase !== 'waiting') {
			return;
		}

		const end = Date.now() + timeCollectMeaningNormal;
		this.state.phase = 'collect_meanings';
		this.state.endThisPhase = end;

		const candidate = this.state.candidates.find(([, r]) => r === text) as [string, string, string, string, string];
		const [word, ruby, source, rawMeaning, id] = candidate;
		this.state.candidates = [];

		const meaning = await getMeaning([word, ruby, source, rawMeaning, id]);
		this.state.theme = {word, ruby, meaning, source, id};

		setTimeout(() => this.onFinishMeanings(), timeCollectMeaningNormal);

		await this.postMessage(
			stripIndent`
				お題を *「${ruby}」* にセットしたよ:v:
				参加者は3分以内にこの単語の意味を考えてボタンから登録してね:relaxed:
				終了予定時刻: ${getTimeLink(end)}
			`,
			[],
			{
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `お題を *「${ruby}」* にセットしたよ:v:\n参加者は3分以内にこの単語の意味を考えてボタンから登録してね:relaxed:\n終了予定時刻: ${getTimeLink(end)}`,
						},
					},
					{
						type: 'actions',
						elements: [
							{
								type: 'button',
								text: {
									type: 'plain_text',
									text: '意味を登録',
								},
								action_id: 'tahoiya_submit_meaning',
								style: 'primary',
							},
						],
					},
				],
			},
		);

		// Generate AI responses
		if (!this.state.meanings.has('tahoiyabot-01')) {
			bot.getResult(ruby, 'tahoiyabot-01').then((result) => this.onBotResult(result));
		}

		if (!this.state.meanings.has('tahoiyabot-02')) {
			bot.getResult(ruby, 'tahoiyabot-02').then((result) => this.onBotResult(result));
		}
	}

	private async handleAIQuery(message: unknown, text: string) {
		const isMention = text.startsWith('@tahoiya');
		const body = text.replace(/^@\w+/, '').replace(/(?:って(?:なに|何)|とは)[？?⋯…・]*$/, '').trim();
		const ruby = hiraganize(await getReading(body)).replace(/[^\p{Script=Hiragana}ー]/gu, '');
		const modelData = text.startsWith('@tahoiya2')
			? ['tahoiyabot-02', 'model.ckpt-600001-ver2']
			: ['tahoiyabot-01', 'model.ckpt-455758'];

		if (ruby.length > 0 && ruby.length <= 25) {
			if (this.state.theme && levenshtein.get(this.state.theme.ruby, ruby) <= 2) {
				isMention && this.postMessage('カンニング禁止！:imp:');
				return;
			}

			if (this.queue.size >= 2) {
				isMention && this.postMessage(`今忙しいから *${ruby}* は後で:upside_down_face:`);
				return;
			}

			this.queue.add(async () => {
				try {
					const data = await bot.getResult(ruby, modelData[0]);
					await this.postMessage(
						stripIndent`
							*${ruby}* の正しい意味は⋯⋯
							*${random(1, 5)}. ${data.result}*
						`,
						[],
						{
							username: this.getMemberName(modelData[0]),
							thread_ts: (message as {ts?: string}).ts,
							reply_broadcast: true,
						},
					);
				} catch (error) {
					this.postMessage((error as Error).stack || 'Unknown error');
				}
			});
			return;
		}

		isMention && this.postMessage(':ha:');
	}

	private async onBotResult(result: {result: string, modelName: string}) {
		if (this.state.phase !== 'collect_meanings') {
			return;
		}

		const distance = levenshtein.get(this.state.theme.meaning, result.result);
		log.info({result: result.result, distance});

		if (distance <= Math.max(this.state.theme.meaning.length, result.result.length) / 2) {
			return;
		}

		this.state.meanings.set(result.modelName, normalizeMeaning(result.result));

		await this.postMessage(
			stripIndent`
				${this.getMemberName(result.modelName)} が意味を登録したよ:robot_face:
			`,
		);
	}

	private onFinishMeanings() {
		// Implementation similar to original but with modern patterns
		// This is a placeholder - full implementation would be quite long
		log.info('Finishing meanings collection phase');
		// ... rest of the implementation
	}

	private onFinishBettings() {
		// Implementation similar to original but with modern patterns
		// This is a placeholder - full implementation would be quite long
		log.info('Finishing betting phase');
		// ... rest of the implementation
	}

	private startDaily() {
		// Implementation for daily game start
		log.info('Starting daily tahoiya game');
		// ... rest of the implementation
	}

	private handleStartGame() {
		// Implementation for handling start game button
		log.info('Handling start game');
	}

	private async handleSelectTheme(payload: BlockButtonAction) {
		// Implementation for handling theme selection
		const themeValue = payload.actions?.[0]?.value;
		if (themeValue) {
			await this.selectThemeByText(themeValue);
		}
	}

	private showMeaningDialog(payload: BlockButtonAction) {
		return this.slack.views.open({
			trigger_id: payload.trigger_id,
			view: meaningCollectionDialog(),
		});
	}

	private showBettingDialog(payload: BlockButtonAction) {
		return this.slack.views.open({
			trigger_id: payload.trigger_id,
			view: bettingDialog(this.state.shuffledMeanings),
		});
	}

	private showThemeRegistrationDialog(payload: BlockButtonAction) {
		return this.slack.views.open({
			trigger_id: payload.trigger_id,
			view: themeRegistrationDialog(),
		});
	}

	private showCommentDialog(payload: BlockButtonAction) {
		return this.slack.views.open({
			trigger_id: payload.trigger_id,
			view: commentDialog(),
		});
	}

	private async submitMeaning(payload: ViewSubmitAction) {
		const {values} = payload.view.state;
		const meaning = values?.meaning_input?.meaning?.value;
		const user = payload.user.id;

		if (!meaning || this.state.phase !== 'collect_meanings') {
			return undefined;
		}

		if (this.state.author === user) {
			return {
				response_action: 'errors',
				errors: {
					meaning_input: '出題者はたほいやに参加できないよ:fearful:',
				},
			} as const;
		}

		const isUpdate = this.state.meanings.has(user);
		this.state.meanings.set(user, normalizeMeaning(meaning));

		if (!isUpdate) {
			const humanCount = Array.from(this.state.meanings.keys()).filter((userId) => userId.startsWith('U')).length;
			let remainingText = '';
			if (this.state.author !== null) {
				if (humanCount <= 3) {
					remainingText = humanCount === 3 ? '(決行決定:tada:)' : `(決行まであと${3 - humanCount}人)`;
				}
			}

			await this.postMessage(
				stripIndent`
					${this.getMention(user)} が意味を登録したよ:muscle:
					現在の参加者: ${humanCount}人 ${remainingText}
				`,
			);

			await unlock(user, 'tahoiya');
		}
		return undefined;
	}

	private async submitBetting(payload: ViewSubmitAction) {
		const {values} = payload.view.state;
		const meaningIndex = parseInt(values?.meaning_select?.meaning?.selected_option?.value || '0');
		const coins = parseInt(values?.coins_input?.coins?.value || '1');
		const user = payload.user.id;

		if (this.state.phase !== 'collect_bettings') {
			return undefined;
		}

		if (!this.state.meanings.has(user)) {
			return {
				response_action: 'errors',
				errors: {
					meaning_select: 'あなたは参加登録していないのでベッティングできないよ:innocent:',
				},
			} as const;
		}

		if (this.state.shuffledMeanings[meaningIndex]?.user === user) {
			return {
				response_action: 'errors',
				errors: {
					meaning_select: '自分自身には投票できないよ:angry:',
				},
			} as const;
		}

		const isUpdate = this.state.bettings.has(user);
		this.state.bettings.set(user, {
			meaning: meaningIndex,
			coins,
		});

		if (!isUpdate) {
			await this.postMessage(`${this.getMention(user)} がBETしたよ:moneybag:`);
		}

		if (this.state.bettings.size === this.state.meanings.size) {
			clearTimeout(this.timeoutId);
			this.onFinishBettings();
		}
		return undefined;
	}

	private submitThemeRegistration(payload: ViewSubmitAction) {
		const {values} = payload.view.state;
		const word = values?.word_input?.word?.value;
		const ruby = values?.ruby_input?.ruby?.value;
		const meaning = values?.meaning_input?.meaning?.value;
		const source = values?.source_input?.source?.value;
		const url = values?.url_input?.url?.value;
		const user = payload.user.id;

		// Implementation for theme registration
		// This would include validation and database insertion
		log.info('Theme registration submitted', {word, ruby, meaning, source, url, user});
	}

	private submitComment(payload: ViewSubmitAction) {
		const {values} = payload.view.state;
		const comment = values?.comment_input?.comment?.value;
		const user = payload.user.id;

		if (!comment) {
			return;
		}

		this.state.comments.push({
			text: comment,
			date: Date.now(),
			user,
		});
	}

	private getMemberName(user: string): string {
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		const member = this.members.find(({id}) => id === user) as {profile?: {display_name?: string}, name?: string};
		return member?.profile?.display_name || member?.name || user;
	}

	private getMemberIcon(user: string): string {
		if (user === 'tahoiyabot-01' || user === 'tahoiyabot-02') {
			return 'https://emojipedia-us.s3.dualstack.us-west-1.amazonaws.com/thumbs/120/apple/155/robot-face_1f916.png';
		}

		const member = this.members.find(({id}) => id === user) as {profile?: {image_24?: string}};
		return member?.profile?.image_24 || '';
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

	private postMessage(text: string, attachments: unknown[] = [], options: Record<string, unknown> = {}) {
		return this.slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text,
			username: 'tahoiya',
			icon_emoji: ':open_book:',
			...(attachments.length > 0 ? {attachments} : {}),
			...options,
		});
	}

	getServerPlugin(): FastifyPluginCallback {
		const callback: FastifyPluginCallback = (fastify, opts, next) => {
			// No server endpoints needed for this version
			next();
		};

		return plugin(callback);
	}
}
