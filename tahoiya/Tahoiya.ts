import {randomUUID} from 'crypto';
import type {BlockButtonAction, ViewSubmitAction} from '@slack/bolt';
import type {ChatPostMessageArguments, KnownBlock, GenericMessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
// @ts-expect-error: fast-levenshtein has no type declarations
import levenshtein from 'fast-levenshtein';
import {minBy, maxBy, sample, sampleSize, shuffle, sum} from 'lodash';
import {scheduleJob} from 'node-schedule';
// @ts-expect-error: rouge has no type declarations
import rouge from 'rouge';
import {increment} from '../achievements';
import {getCandidateWords} from '../lib/candidateWords';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {db} from '../lib/firestore';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {getAIBotMeaning} from './aibot';
import type {AIBotModel} from './aibot';
import {calculateRatingDeltas} from './rating';
import type {
	DailyGameState,
	NormalGameState,
	TahoiyaState,
	DictionarySource,
	DictionaryTheme,
	ShuffledMeaning,
	RatingChange,
	GameRecord,
	StoredTheme,
	PlayerResult,
	WordEntry,
} from './types';
import {getMeaning, getWordUrl, normalizeMeaning, SOURCE_LABELS} from './utils';
import bettingModal from './views/bettingModal';
import candidatesMessage from './views/candidatesMessage';
import collectBettingsMessage from './views/collectBettingsMessage';
import collectMeaningsMessage from './views/collectMeaningsMessage';
import dailyStatusMessage from './views/dailyStatusMessage';
import {
	registerThemeModeSelectModal,
	registerThemeDictModal,
	registerThemeArbitraryModal,
} from './views/registerThemeModal';
import resultsMessage from './views/resultsMessage';
import submitMeaningModal from './views/submitMeaningModal';

const mutex = new Mutex();

const TIME_COLLECT_MEANING_NORMAL = 3 * 60 * 1000;
const TIME_COLLECT_BETTING_NORMAL = 3 * 60 * 1000;
const TIME_COLLECT_BETTING_DAILY = 60 * 60 * 1000;
const DUMMY_SIZE_BASE = 4;
const DAILY_TAHOIYA_MINIMUM_PARTICIPANTS = 3;

const AI_BOT_MODELS: AIBotModel[] = ['tahoiyabot-01', 'tahoiyabot-02'];

export class Tahoiya extends ChannelLimitedBot {
	protected override wakeWordRegex = /^(?:たほいや|デイリーたほいや)$/;

	protected override allowedChannels = [process.env.CHANNEL_SANDBOX!];

	protected override username = 'tahoiya';

	protected override iconEmoji = ':open_book:';

	#state!: TahoiyaState;

	#candidateWords: WordEntry[] = [];

	#normalBettingTimeout: ReturnType<typeof setTimeout> | null = null;

	#dailyBettingTimeout: ReturnType<typeof setTimeout> | null = null;

	// In-memory theme store for dev mode (when Firestore is unavailable)
	#devThemes: Map<string, StoredTheme> = new Map();

	static async create(slack: SlackInterface) {
		const instance = new Tahoiya(slack);
		await instance.#initialize();
		return instance;
	}

	async #initialize() {
		this.#state = await State.init<TahoiyaState>('tahoiya', {
			normalGame: null,
			dailyGame: null,
			ratings: {},
			gamesPlayed: {},
			lastGameScore: {},
			dailyStatusMessageTs: null,
			authorHistory: [],
		});

		this.#candidateWords = (await getCandidateWords()) as WordEntry[];

		this.#registerInteractions();

		scheduleJob('0 21 * * *', () => {
			mutex.runExclusive(() => this.#triggerDailyBetting());
		});

		// Restore timers
		if (this.#state.normalGame?.phase === 'collect_bettings') {
			const remaining = this.#state.normalGame.endPhaseAt - Date.now();
			this.#normalBettingTimeout = setTimeout(
				() => mutex.runExclusive(() => this.#finishNormalGame()),
				Math.max(remaining, 60000),
			);
		}

		if (this.#state.dailyGame?.phase === 'collect_bettings') {
			const remaining = this.#state.dailyGame.endPhaseAt - Date.now();
			this.#dailyBettingTimeout = setTimeout(
				() => mutex.runExclusive(() => this.#finishDailyGame()),
				Math.max(remaining, 60000),
			);
		}

		if (this.#state.dailyGame === null) {
			await mutex.runExclusive(() => this.#selectNextDailyTheme());
		}

		this.log.info('Tahoiya initialized');
	}

	protected override onWakeWord(event: GenericMessageEvent, targetChannel: string): Promise<string | null> {
		const text = event.text?.trim();
		if (text === 'たほいや') {
			return mutex.runExclusive(() => this.#startNormalGame(event.user!, targetChannel));
		}
		if (text === 'デイリーたほいや') {
			return mutex.runExclusive(() => this.#showDailyStatus(targetChannel, null));
		}
		return Promise.resolve(null);
	}

	#registerInteractions() {
		// Candidate selection
		this.messageClient.action({type: 'button', actionId: /^tahoiya_select_theme_/}, (payload: BlockButtonAction) => {
			const ruby = payload.actions?.[0]?.value;
			if (ruby) {
				mutex.runExclusive(() => this.#selectTheme(ruby, payload.user.id)).catch((err) => this.log.error(err));
			}
		});

		// Normal game: submit meaning button
		this.messageClient.action({type: 'button', actionId: 'tahoiya_normal_submit_meaning_button'}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => this.#openSubmitMeaningModal(payload.trigger_id, 'normal', payload.user.id)).catch((err) => this.log.error(err));
		});

		// Daily game: submit meaning button
		this.messageClient.action({type: 'button', actionId: 'tahoiya_daily_submit_meaning_button'}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => this.#openSubmitMeaningModal(payload.trigger_id, 'daily', payload.user.id)).catch((err) => this.log.error(err));
		});

		// Register theme button → open mode select modal (step 1)
		this.messageClient.action({type: 'button', actionId: 'tahoiya_register_theme_button'}, (payload: BlockButtonAction) => {
			this.slack.views.open({trigger_id: payload.trigger_id, view: registerThemeModeSelectModal()}).catch((err) => this.log.error(err));
		});

		// Mode select: dictionary (step 2a)
		this.messageClient.action({type: 'button', actionId: 'tahoiya_theme_mode_dict'}, (payload: BlockButtonAction) => {
			this.slack.views.push({trigger_id: payload.trigger_id, view: registerThemeDictModal()}).catch((err) => this.log.error(err));
		});

		// Mode select: arbitrary (step 2b)
		this.messageClient.action({type: 'button', actionId: 'tahoiya_theme_mode_arbitrary'}, (payload: BlockButtonAction) => {
			this.slack.views.push({trigger_id: payload.trigger_id, view: registerThemeArbitraryModal()}).catch((err) => this.log.error(err));
		});

		// Normal bet button
		this.messageClient.action({type: 'button', actionId: 'tahoiya_normal_bet_button'}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => this.#openBetModal(payload.trigger_id, 'normal', payload.user.id)).catch((err) => this.log.error(err));
		});

		// Daily bet button
		this.messageClient.action({type: 'button', actionId: 'tahoiya_daily_bet_button'}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => this.#openBetModal(payload.trigger_id, 'daily', payload.user.id)).catch((err) => this.log.error(err));
		});

		// Submit meaning: normal
		this.messageClient.viewSubmission('tahoiya_normal_submit_meaning_modal', (payload: ViewSubmitAction) => {
			const values = Object.assign({}, ...Object.values(payload.view.state.values ?? {})) as Record<string, {value?: string}>;
			const meaning = values?.meaning?.value?.trim();
			const userId = payload.user.id;
			if (meaning) {
				mutex.runExclusive(() => this.#submitMeaning('normal', userId, meaning)).catch((err) => this.log.error(err));
			}
		});

		// Submit meaning: daily
		this.messageClient.viewSubmission('tahoiya_daily_submit_meaning_modal', (payload: ViewSubmitAction) => {
			const values = Object.assign({}, ...Object.values(payload.view.state.values ?? {})) as Record<string, {value?: string}>;
			const meaning = values?.meaning?.value?.trim();
			const userId = payload.user.id;
			if (meaning) {
				mutex.runExclusive(() => this.#submitMeaning('daily', userId, meaning)).catch((err) => this.log.error(err));
			}
		});

		// Submit vote: normal
		this.messageClient.viewSubmission('tahoiya_normal_bet_modal', (payload: ViewSubmitAction) => {
			const values = Object.assign({}, ...Object.values(payload.view.state.values ?? {})) as Record<string, {selected_option?: {value: string}}>;
			const meaningIndex = parseInt(values?.meaning_index?.selected_option?.value ?? '-1');
			const userId = payload.user.id;
			if (meaningIndex >= 0) {
				mutex.runExclusive(() => this.#submitVote('normal', userId, meaningIndex)).catch((err) => this.log.error(err));
			}
		});

		// Submit vote: daily
		this.messageClient.viewSubmission('tahoiya_daily_bet_modal', (payload: ViewSubmitAction) => {
			const values = Object.assign({}, ...Object.values(payload.view.state.values ?? {})) as Record<string, {selected_option?: {value: string}}>;
			const meaningIndex = parseInt(values?.meaning_index?.selected_option?.value ?? '-1');
			const userId = payload.user.id;
			if (meaningIndex >= 0) {
				mutex.runExclusive(() => this.#submitVote('daily', userId, meaningIndex)).catch((err) => this.log.error(err));
			}
		});

		// Register theme: dictionary form submit
		this.messageClient.viewSubmission('tahoiya_register_theme_dict_modal', (payload: ViewSubmitAction) => {
			const values = Object.assign({}, ...Object.values(payload.view.state.values ?? {})) as Record<string, {value?: string; selected_options?: {value: string}[]}>;
			const userId = payload.user.id;
			return mutex.runExclusive(() => this.#registerDictTheme(userId, values));
		});

		// Register theme: arbitrary form submit
		this.messageClient.viewSubmission('tahoiya_register_theme_arbitrary_modal', (payload: ViewSubmitAction) => {
			const values = Object.assign({}, ...Object.values(payload.view.state.values ?? {})) as Record<string, {value?: string; selected_options?: {value: string}[]}>;
			const userId = payload.user.id;
			return mutex.runExclusive(() => this.#registerArbitraryTheme(userId, values));
		});
	}

	async #startNormalGame(userId: string, channel: string): Promise<string | null> {
		if (this.#state.normalGame?.phase !== 'select_theme') {
			if (this.#state.normalGame !== null) {
				await this.slack.chat.postEphemeral({
					channel,
					user: userId,
					text: '通常たほいやは現在進行中です。',
				});
				return null;
			}

			const now = Date.now();

			this.#state.normalGame = {
				phase: 'select_theme',
				startedBy: userId,
				candidates: [],
				theme: null,
				meanings: {},
				shuffledMeanings: [],
				votes: {},
				endPhaseAt: now,
				gameMessageTs: null,
				bettingMessageTs: null,
				startedAt: now,
			};
		}

		this.#state.normalGame.candidates = sampleSize(this.#candidateWords, 10);

		const result = await this.#postMessage({
			channel,
			text: 'たほいや開始！',
			blocks: candidatesMessage(this.#state.normalGame.candidates),
		});
		this.#state.normalGame.gameMessageTs = result.ts ?? null;

		return result.ts ?? null;
	}

	async #selectTheme(ruby: string, triggerUserId: string) {
		if (this.#state.normalGame?.phase !== 'select_theme') {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: triggerUserId,
				text: 'お題の選択フェーズではありません。',
			});
			return;
		}

		const candidate = this.#state.normalGame.candidates.find((c) => c[1] === ruby);
		if (!candidate) {
			return;
		}

		let meaning = '';
		try {
			meaning = await getMeaning(candidate);
		} catch (err) {
			this.log.error('getMeaning failed:', err);
		}

		if (!meaning) {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: triggerUserId,
				text: 'この単語の意味を取得できませんでした。別の単語を選んでください。',
			});
			return;
		}

		const source = candidate[2] as DictionarySource;
		const theme: DictionaryTheme = {
			type: 'dictionary',
			word: candidate[0],
			ruby: candidate[1],
			meaning,
			source,
			sourceString: SOURCE_LABELS[source] ?? source,
			sourceUrl: getWordUrl(candidate[0], source, candidate[4]),
		};

		const endPhaseAt = Date.now() + TIME_COLLECT_MEANING_NORMAL;
		this.#state.normalGame = {
			...this.#state.normalGame,
			phase: 'collect_meanings',
			theme,
			endPhaseAt,
		};

		await this.#updateNormalGameMessage();

		setTimeout(() => {
			mutex.runExclusive(() => this.#startNormalBettingsPhase());
		}, TIME_COLLECT_MEANING_NORMAL);

		// AI bots in background
		for (const modelId of AI_BOT_MODELS) {
			this.log.info(`Requesting AI bot (${modelId}) for meaning of "${theme.ruby}"...`);

			getAIBotMeaning(candidate[1], modelId).then((aiResult) => {
				this.log.info(`AI bot (${modelId}) responded: ${aiResult?.result ? aiResult.result : 'no result'}`);
				if (!aiResult?.result) {
					return;
				}
				mutex.runExclusive(async () => {
					if (this.#state.normalGame?.phase !== 'collect_meanings') {
						return;
					}
					if (this.#state.normalGame.theme?.type !== 'dictionary') {
						return;
					}

					const dist = levenshtein.get(this.#state.normalGame.theme.meaning, aiResult.result);
					const maxLen = Math.max(this.#state.normalGame.theme.meaning.length, aiResult.result.length);
					if (dist <= maxLen / 2) {
						return;
					}

					this.#state.normalGame.meanings[modelId] = normalizeMeaning(aiResult.result);
					await this.#updateNormalGameMessage();
					await this.#postThread('normal', {text: `${modelId} が意味を登録したよ :robot_face:`});
				});
			}).catch((err) => this.log.error('AI bot error:', err));
		}
	}

	async #startNormalBettingsPhase() {
		const game = this.#state.normalGame;
		if (!game || game.phase !== 'collect_meanings') {
			return;
		}

		const shuffled = await this.#buildShuffledMeanings(game);
		const endPhaseAt = Date.now() + TIME_COLLECT_BETTING_NORMAL;

		this.#state.normalGame = {
			...game,
			phase: 'collect_bettings',
			shuffledMeanings: shuffled,
			endPhaseAt,
			bettingMessageTs: null,
		};

		// Disable the meanings message
		await this.#updateNormalGameMessage(true);

		// Post new betting message with mentions, broadcast to channel
		const humanParticipants = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
		const mentions = humanParticipants.map((u) => `<@${u}>`).join(' ');
		const mentionBlock: KnownBlock[] = mentions ? [{
			type: 'section',
			text: {type: 'mrkdwn', text: mentions},
		}] : [];
		const bettingResult = await this.#postThread('normal', {
			text: `たほいや投票フェーズ開始！${mentions ? `\n${mentions} 投票してください！` : ''}`,
			blocks: [...mentionBlock, ...collectBettingsMessage(this.#state.normalGame, 'normal')],
			broadcast: true,
		});
		this.#state.normalGame.bettingMessageTs = bettingResult?.ts ?? null;

		await this.#doAIBets('normal');

		if (humanParticipants.length >= 3) {
			for (const u of humanParticipants) {
				await increment(u, 'tahoiya-participate');
			}
		}

		this.#normalBettingTimeout = setTimeout(() => {
			mutex.runExclusive(() => this.#finishNormalGame());
		}, TIME_COLLECT_BETTING_NORMAL);
	}

	async #finishNormalGame() {
		const game = this.#state.normalGame;
		if (!game || game.phase !== 'collect_bettings') {
			return;
		}

		if (this.#normalBettingTimeout) {
			clearTimeout(this.#normalBettingTimeout);
			this.#normalBettingTimeout = null;
		}

		// Disable the betting message
		await this.#disableBettingMessage('normal');

		const results = this.#calculateResults(game);
		const ratingChanges = this.#applyRatings(results);

		await this.#postResultsMessage(game, results, ratingChanges, 'normal');
		await this.#grantAchievements(game, results, ratingChanges);
		await this.#saveGameRecord(game, 'normal');

		this.#state.normalGame = null;
	}

	async #selectNextDailyTheme(announce = false) {
		const themes = await this.#fetchAvailableThemes();

		if (themes.length === 0) {
			this.log.warn('No daily themes available');
			await this.#postThread('daily', {
				text: '次のデイリーたほいやのお題が見つかりませんでした。お題を募集しています！',
				broadcast: true,
			});
			return;
		}

		const [theme] = themes;

		this.#state.dailyGame = {
			phase: 'collect_meanings',
			themeId: theme.id,
			themeAuthor: theme.submittedBy,
			theme: theme.theme,
			meanings: {},
			shuffledMeanings: [],
			votes: {},
			endPhaseAt: Date.now(),
			gameMessageTs: this.#state.dailyStatusMessageTs,
			bettingMessageTs: null,
			startedAt: Date.now(),
		};

		await this.#updateDailyStatusMessage();

		if (announce) {
			const themeLabel = theme.theme.type === 'dictionary'
				? `「${theme.theme.ruby}」`
				: `「${theme.theme.question}」`;
			await this.#postThread('daily', {
				text: stripIndent`
					明日のデイリーたほいやのお題はこれ！
					お題: ${themeLabel} (出題者: <@${theme.submittedBy}>)

					明日の21時までに、「意味を登録する」ボタンから意味を登録してね :writing_hand:
				`,
				broadcast: true,
			});
		}

		// AI bots submit meanings for dictionary themes in the background
		if (theme.theme.type === 'dictionary') {
			for (const modelId of AI_BOT_MODELS) {
				getAIBotMeaning(theme.theme.ruby, modelId).then((aiResult) => {
					if (!aiResult?.result) {
						return;
					}
					mutex.runExclusive(() => {
						if (this.#state.dailyGame?.themeId !== theme.id) {
							return Promise.resolve();
						}
						if (this.#state.dailyGame.phase !== 'collect_meanings') {
							return Promise.resolve();
						}

						const dist = levenshtein.get((theme.theme as DictionaryTheme).meaning, aiResult.result);
						const maxLen = Math.max((theme.theme as DictionaryTheme).meaning.length, aiResult.result.length);
						if (dist <= maxLen / 2) {
							return Promise.resolve();
						}

						this.#state.dailyGame.meanings[modelId] = normalizeMeaning(aiResult.result);
						return Promise.resolve();
					});
				}).catch((err) => this.log.error('AI bot error (daily):', err));
			}
		}
	}

	async #triggerDailyBetting() {
		const game = this.#state.dailyGame;
		if (!game || game.phase !== 'collect_meanings') {
			await this.#showDailyStatus(
				this.allowedChannels[0],
				'お題ストックが不足しているため、デイリーたほいやはスキップされました😢',
			);
			return;
		}

		const humanCount = Object.keys(game.meanings).filter((u) => u.startsWith('U')).length;
		if (humanCount < DAILY_TAHOIYA_MINIMUM_PARTICIPANTS) {
			await this.#showDailyStatus(
				this.allowedChannels[0],
				`参加者が${DAILY_TAHOIYA_MINIMUM_PARTICIPANTS}人未満のため、デイリーたほいやはスキップされました😢`,
			);
			return;
		}

		const shuffled = await this.#buildShuffledMeanings(game);
		const endPhaseAt = Date.now() + TIME_COLLECT_BETTING_DAILY;

		this.#state.dailyGame = {
			...game,
			phase: 'collect_bettings',
			shuffledMeanings: shuffled,
			endPhaseAt,
			bettingMessageTs: null,
		};

		await this.#updateDailyStatusMessage();

		// Announce betting with mentions
		const humanParticipants = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
		const mentions = humanParticipants.map((u) => `<@${u}>`).join(' ');
		const themeLabel = game.theme.type === 'dictionary'
			? `「${game.theme.ruby}」`
			: `「${game.theme.question}」`;

		const mentionBlock: KnownBlock[] = mentions ? [{
			type: 'section',
			text: {type: 'mrkdwn', text: `${mentions} 60分以内に投票してください！`},
		}] : [];
		const bettingResult = await this.#postThread('daily', {
			text: `デイリーたほいや ${themeLabel} の投票フェーズが始まりました！\n${mentions} 60分以内に投票してください！`,
			blocks: [...mentionBlock, ...collectBettingsMessage(this.#state.dailyGame, 'daily')],
			broadcast: true,
		});
		this.#state.dailyGame.bettingMessageTs = bettingResult?.ts ?? null;

		this.#doAIBets('daily');

		if (humanCount >= 3) {
			for (const u of humanParticipants) {
				await increment(u, 'tahoiya-participate');
			}
		}

		this.#dailyBettingTimeout = setTimeout(() => {
			mutex.runExclusive(() => this.#finishDailyGame());
		}, TIME_COLLECT_BETTING_DAILY);
	}

	async #finishDailyGame() {
		const game = this.#state.dailyGame;
		if (!game || game.phase !== 'collect_bettings') {
			return;
		}

		if (this.#dailyBettingTimeout) {
			clearTimeout(this.#dailyBettingTimeout);
			this.#dailyBettingTimeout = null;
		}

		await this.#disableBettingMessage('daily');

		const correctMeaningIndex = game.shuffledMeanings.findIndex((m) => m.isCorrect);
		const humanVoters = Object.entries(game.votes).filter(([u]) => u.startsWith('U'));
		const humanCorrectCount = humanVoters.filter(([, idx]) => idx === correctMeaningIndex).length;
		const humanWrongCount = humanVoters.length - humanCorrectCount;

		const results = this.#calculateResults(game);
		results.push({
			userId: game.themeAuthor,
			score: humanWrongCount,
			isCorrect: false,
			deceived: [],
		});

		const ratingChanges = this.#applyRatings(results);

		await this.#markThemeUsed(game.themeId);

		this.#state.authorHistory = [
			...this.#state.authorHistory.filter((a) => a !== game.themeAuthor),
			game.themeAuthor,
		].slice(-10);

		await this.#postResultsMessage(game, results, ratingChanges, 'daily');
		await this.#grantAchievements(game, results, ratingChanges);
		await this.#saveGameRecord(game, 'daily');

		this.#state.dailyGame = null;

		await this.#selectNextDailyTheme(true);
	}

	async #openSubmitMeaningModal(triggerId: string, gameType: 'normal' | 'daily', userId: string) {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game?.theme || game.phase !== 'collect_meanings') {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: userId,
				text: '現在は意味の登録フェーズではありません。',
			});
			return;
		}

		if (gameType === 'daily' && this.#state.dailyGame?.themeAuthor === userId) {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: userId,
				text: 'お題を出題したため、このゲームには参加できません。',
			});
			return;
		}

		const existingMeaning = game.meanings[userId];
		await this.slack.views.open({
			trigger_id: triggerId,
			view: submitMeaningModal(game.theme, gameType, existingMeaning),
		}).catch((err) => this.log.error('failed to open modal:', err));
	}

	async #openBetModal(triggerId: string, gameType: 'normal' | 'daily', userId: string) {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game || game.phase !== 'collect_bettings' || game.shuffledMeanings.length === 0) {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: userId,
				text: '現在は投票フェーズではありません。',
			});
			return;
		}

		if (gameType === 'daily' && this.#state.dailyGame?.themeAuthor === userId) {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: userId,
				text: 'お題を出題したため、このゲームの投票には参加できません。',
			});
			return;
		}

		await this.slack.views.open({
			trigger_id: triggerId,
			view: bettingModal(game.shuffledMeanings, gameType, userId),
		}).catch((err) => this.log.error('failed to open modal:', err));
	}

	async #submitMeaning(gameType: 'normal' | 'daily', userId: string, meaning: string) {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game || game.phase !== 'collect_meanings') {
			return;
		}

		if (gameType === 'daily' && this.#state.dailyGame?.themeAuthor === userId) {
			return;
		}

		const trimmed = meaning.trim().slice(0, 256);
		if (!trimmed) {
			return;
		}

		game.meanings[userId] = trimmed;

		if (gameType === 'normal') {
			await this.#updateNormalGameMessage();
		} else {
			await this.#updateDailyStatusMessage();
		}

		if (userId.startsWith('U')) {
			await this.#postThread(gameType, {text: `<@${userId}> が意味を登録したよ👍️`});
		}
	}

	async #submitVote(gameType: 'normal' | 'daily', userId: string, meaningIndex: number) {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game || game.phase !== 'collect_bettings') {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: userId,
				text: 'このゲームの投票フェーズはすでに終了しています。',
			});
			return;
		}

		if (gameType === 'daily' && this.#state.dailyGame?.themeAuthor === userId) {
			return;
		}

		const clampedIndex = Math.max(0, Math.min(meaningIndex, game.shuffledMeanings.length - 1));

		if (game.shuffledMeanings[clampedIndex]?.userId === userId) {
			await this.slack.chat.postEphemeral({
				channel: this.allowedChannels[0],
				user: userId,
				text: '自分が提出した意味には投票できません。',
			});
			return;
		}

		game.votes[userId] = clampedIndex;

		if (gameType === 'normal') {
			await this.#updateBettingMessage('normal');
		} else {
			await this.#updateBettingMessage('daily');
		}

		// Check if all human participants voted (normal game only)
		if (gameType === 'normal') {
			const humanMeaningUsers = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
			const humanVoteUsers = Object.keys(game.votes).filter((u) => u.startsWith('U'));
			if (humanMeaningUsers.length > 0 && humanMeaningUsers.every((u) => humanVoteUsers.includes(u))) {
				if (this.#normalBettingTimeout) {
					clearTimeout(this.#normalBettingTimeout);
					this.#normalBettingTimeout = null;
				}
				await this.#finishNormalGame();
			}
		}
	}

	async #registerDictTheme(
		userId: string,
		values: Record<string, {value?: string; selected_options?: {value: string}[]}>,
	): Promise<{response_action: string; errors?: Record<string, string>} | void> {
		const word = values?.word?.value?.trim() ?? '';
		const ruby = values?.ruby?.value?.trim() ?? '';
		const meaning = values?.meaning?.value?.trim() ?? '';
		const source = values?.source?.value?.trim() ?? '';
		const url = values?.url?.value?.trim() ?? '';

		const errors: Record<string, string> = {};
		if (!values?.regulation_confirmed?.selected_options?.some((o) => o.value === 'confirmed')) {
			errors.regulation_input = 'レギュレーションを確認してください';
		}
		if (!word) {
			errors.word_input = '単語を入力してください';
		}
		if (!ruby) {
			errors.ruby_input = '読みを入力してください';
		} else if (!(/^\p{Script_Extensions=Hiragana}+$/u).test(ruby)) {
			errors.ruby_input = 'ひらがなのみで入力してください';
		}
		if (!meaning) {
			errors.meaning_input = '意味を入力してください';
		}
		if (!source) {
			errors.source_input = '出典を入力してください';
		}
		if (!url) {
			errors.url_input = 'URLを入力してください';
		} else if (!(/^https?:\/\//i).test(url)) {
			errors.url_input = '有効なURLを入力してください（https://...）';
		}

		if (Object.keys(errors).length > 0) {
			return {response_action: 'errors', errors};
		}

		const stored: StoredTheme = {
			id: randomUUID(),
			submittedBy: userId,
			submittedAt: Date.now(),
			used: false,
			usedAt: null,
			theme: {
				type: 'dictionary',
				word,
				ruby,
				meaning,
				source,
				sourceString: source,
				sourceUrl: url,
			},
		};

		await this.#saveTheme(stored);
		await increment(userId, 'daily-tahoiya-theme');
		await this.#postMessage({text: `<@${userId}> がデイリーたほいやのお題を登録しました！`});
		if (this.#state.dailyGame === null) {
			await this.#selectNextDailyTheme(true);
		}
		return undefined;
	}

	async #registerArbitraryTheme(
		userId: string,
		values: Record<string, {value?: string; selected_options?: {value: string}[]}>,
	): Promise<{response_action: string; errors?: Record<string, string>} | void> {
		const question = values?.question?.value?.trim() ?? '';
		const answer = values?.answer?.value?.trim() ?? '';
		const url = values?.url?.value?.trim() ?? '';

		const errors: Record<string, string> = {};
		if (!values?.regulation_confirmed?.selected_options?.some((o) => o.value === 'confirmed')) {
			errors.regulation_input = 'レギュレーションを確認してください';
		}
		if (!question) {
			errors.question_input = 'お題文を入力してください';
		}
		if (!answer) {
			errors.answer_input = '正解を入力してください';
		}
		if (!url) {
			errors.url_input = 'URLを入力してください';
		} else if (!(/^https?:\/\//i).test(url)) {
			errors.url_input = '有効なURLを入力してください（https://...）';
		}

		if (Object.keys(errors).length > 0) {
			return {response_action: 'errors', errors};
		}

		const stored: StoredTheme = {
			id: randomUUID(),
			submittedBy: userId,
			submittedAt: Date.now(),
			used: false,
			usedAt: null,
			theme: {type: 'arbitrary', question, answer, sourceUrl: url},
		};

		await this.#saveTheme(stored);
		await increment(userId, 'daily-tahoiya-theme');
		await increment(userId, 'tahoiya-arbitrary-theme');
		await this.#postMessage({text: `<@${userId}> がデイリーたほいやのお題を登録しました！`});
		if (this.#state.dailyGame === null) {
			await this.#selectNextDailyTheme(true);
		}
		return undefined;
	}

	async #showDailyStatus(channel: string, skipNotice: string | null): Promise<string | null> {
		const themeCount = await this.#countAvailableThemes();
		const blocks = dailyStatusMessage(this.#state.dailyGame, themeCount, skipNotice);

		if (this.#state.dailyStatusMessageTs) {
			await this.slack.chat.delete({
				channel,
				ts: this.#state.dailyStatusMessageTs,
			}).catch(() => {
				this.log.error('failed to delete old daily status message, ignoring');
			});
		}

		const result = await this.#postThread('daily', {
			text: 'デイリーたほいや',
			blocks,
			broadcast: true,
		});
		this.#state.dailyStatusMessageTs = result.ts ?? null;

		if (this.#state.dailyGame) {
			this.#state.dailyGame.gameMessageTs = result.ts ?? null;
		}

		return result.ts ?? null;
	}

	async #updateNormalGameMessage(disabled = false) {
		const game = this.#state.normalGame;
		if (!game?.gameMessageTs) {
			return;
		}

		const blocks: KnownBlock[] = game.phase === 'select_theme'
			? candidatesMessage(game.candidates)
			: collectMeaningsMessage(game, 'normal', disabled);

		await this.slack.chat.update({
			channel: this.allowedChannels[0],
			ts: game.gameMessageTs,
			text: 'たほいや',
			blocks,
		}).catch((err) => this.log.error('failed to update normal game message:', err));
	}

	async #updateBettingMessage(gameType: 'normal' | 'daily') {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game?.bettingMessageTs || game.phase !== 'collect_bettings') {
			return;
		}

		await this.slack.chat.update({
			channel: this.allowedChannels[0],
			ts: game.bettingMessageTs,
			text: 'たほいや 投票フェーズ',
			blocks: collectBettingsMessage(game, gameType),
		}).catch((err) => this.log.error('failed to update betting message:', err));
	}

	async #disableBettingMessage(gameType: 'normal' | 'daily') {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game?.bettingMessageTs) {
			return;
		}

		await this.slack.chat.update({
			channel: this.allowedChannels[0],
			ts: game.bettingMessageTs,
			text: 'たほいや 投票フェーズ（終了）',
			blocks: collectBettingsMessage(game, gameType, true),
		}).catch((err) => this.log.error('failed to disable betting message:', err));
	}

	async #updateDailyStatusMessage() {
		if (!this.#state.dailyStatusMessageTs) {
			return;
		}

		const themeCount = await this.#countAvailableThemes();
		const game = this.#state.dailyGame;
		const blocks: KnownBlock[] = game?.phase === 'collect_bettings'
			? collectBettingsMessage(game, 'daily')
			: dailyStatusMessage(game, themeCount, null);

		await this.slack.chat.update({
			channel: this.allowedChannels[0],
			ts: this.#state.dailyStatusMessageTs,
			text: 'デイリーたほいや',
			blocks,
		}).catch((err) => this.log.error('failed to update daily status message:', err));
	}

	// Post in thread of the game message
	#postThread(
		gameType: 'normal' | 'daily',
		options: {text: string; blocks?: KnownBlock[]; broadcast?: boolean},
	) {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		const threadTs = game?.gameMessageTs ?? undefined;

		return this.#postMessage({
			...options,
			threadTs,
			broadcast: options.broadcast ?? false,
		});
	}

	async #buildShuffledMeanings(game: NormalGameState | DailyGameState): Promise<ShuffledMeaning[]> {
		const theme = game.theme!;
		const correctText = theme.type === 'dictionary' ? theme.meaning : theme.answer;

		const userMeanings: ShuffledMeaning[] = Object.entries(game.meanings)
			.filter(([u]) => !u.startsWith('tahoiyabot'))
			.map(([userId, text]) => ({text, userId, isDummy: false, isCorrect: false}));

		const aiBotMeanings: ShuffledMeaning[] = Object.entries(game.meanings)
			.filter(([u]) => u.startsWith('tahoiyabot'))
			.map(([userId, text]) => ({text, userId, isDummy: true, isCorrect: false}));

		const dummySize = theme.type === 'arbitrary' ? 0 : Math.max(1, DUMMY_SIZE_BASE - Object.keys(game.meanings).length);

		let ambiguateDummy: WordEntry | null = null;
		if ('candidates' in game && theme.type === 'dictionary') {
			ambiguateDummy = minBy(
				this.#candidateWords.filter(([w, r]) => w !== theme.word && r !== theme.ruby),
				([, ruby]) => {
					const dist = levenshtein.get(theme.ruby, ruby);
					return dist === 0 ? Infinity : dist;
				},
			) ?? null;
		}

		const dummyMeanings: ShuffledMeaning[] = await Promise.all(
			Array(dummySize).fill(null).map(async (_, i) => {
				const dummyWord = (i === 0 && ambiguateDummy !== null)
					? ambiguateDummy
					: sample(this.#candidateWords)!;
				const text = await getMeaning(dummyWord);
				const dummyMeaning: ShuffledMeaning = {
					text: text || dummyWord[0],
					userId: null,
					isDummy: true,
					isCorrect: false,
					dummyWord,
				};
				return dummyMeaning;
			}),
		);

		const correctMeaning: ShuffledMeaning = {
			text: correctText,
			userId: null,
			isDummy: false,
			isCorrect: true,
		};

		return shuffle([correctMeaning, ...userMeanings, ...aiBotMeanings, ...dummyMeanings]);
	}

	#doAIBets(gameType: 'normal' | 'daily') {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game || game.phase !== 'collect_bettings') {
			return;
		}

		for (const botId of AI_BOT_MODELS) {
			if (!game.meanings[botId]) {
				continue;
			}

			const botMeaning = game.meanings[botId];
			const candidates = game.shuffledMeanings
				.map((m, idx) => ({...m, idx}))
				.filter(({userId}) => userId !== botId);

			const betTarget = maxBy(candidates, ({text}) => sum([1, 2, 3].map((n) => {
				const minLen = Math.min(text.length, botMeaning.length);
				if (minLen < n) {
					return 0;
				}
				return rouge.n(text, botMeaning, {n, tokenizer: (s: string) => Array.from(s)}) * (10 ** n);
			})) + Math.random() * 1e-10);

			if (betTarget) {
				game.votes[botId] = betTarget.idx;
			}
		}
	}

	#calculateResults(game: NormalGameState | DailyGameState): PlayerResult[] {
		const correctMeaningIndex = game.shuffledMeanings.findIndex((m) => m.isCorrect);
		const scoreMap: Record<string, number> = {};
		const deceived: Record<string, string[]> = {};

		for (const userId of Object.keys(game.meanings)) {
			scoreMap[userId] = 0;
		}

		// Also include voters who didn't register a meaning
		for (const userId of Object.keys(game.votes)) {
			if (!(userId in scoreMap)) {
				scoreMap[userId] = 0;
			}
		}

		for (const [userId, voteIndex] of Object.entries(game.votes)) {
			const isCorrect = voteIndex === correctMeaningIndex;
			if (isCorrect) {
				scoreMap[userId] = (scoreMap[userId] ?? 0) + 2;
			} else {
				const misdirectedUserId = game.shuffledMeanings[voteIndex]?.userId;
				if (misdirectedUserId) {
					// +1 for each player fooled by your fake meaning
					scoreMap[misdirectedUserId] = (scoreMap[misdirectedUserId] ?? 0) + 1;
					if (!deceived[misdirectedUserId]) {
						deceived[misdirectedUserId] = [];
					}
					deceived[misdirectedUserId].push(userId);
				}
			}
		}

		return Object.keys(scoreMap).map((userId) => ({
			userId,
			score: scoreMap[userId] ?? 0,
			isCorrect: game.votes[userId] === correctMeaningIndex,
			deceived: deceived[userId] ?? [],
		}));
	}

	#applyRatings(results: PlayerResult[]): RatingChange[] {
		const humanResults = results.filter((r) => r.userId.startsWith('U'));
		if (humanResults.length < 2) {
			return [];
		}

		const deltas = calculateRatingDeltas(
			humanResults.map((r) => ({userId: r.userId, score: r.score})),
			this.#state.ratings,
		);

		for (const delta of deltas) {
			this.#state.ratings[delta.userId] = delta.newRating;
			this.#state.gamesPlayed[delta.userId] = (this.#state.gamesPlayed[delta.userId] ?? 0) + 1;
		}

		return deltas;
	}

	async #postResultsMessage(
		game: NormalGameState | DailyGameState,
		results: PlayerResult[],
		ratingChanges: RatingChange[],
		gameType: 'normal' | 'daily',
	) {
		const correctMeaningIndex = game.shuffledMeanings.findIndex((m) => m.isCorrect);
		const playerScores = Object.fromEntries(results.map((r) => [r.userId, r.score]));

		const blocks = resultsMessage(
			game.theme!,
			game.shuffledMeanings,
			game.votes,
			ratingChanges.filter((r) => r.userId.startsWith('U')),
			correctMeaningIndex,
			playerScores,
		);

		await this.#postThread(gameType, {text: 'たほいや結果発表！', blocks, broadcast: true});
	}

	async #grantAchievements(
		game: NormalGameState | DailyGameState,
		results: PlayerResult[],
		ratingChanges: RatingChange[],
	) {
		const humanCount = Object.keys(game.meanings).filter((u) => u.startsWith('U')).length;
		const humanResults = results.filter((r) => r.userId.startsWith('U'));

		const sorted = [...humanResults].sort((a, b) => b.score - a.score);
		const firstPlace = sorted[0]?.userId;
		if (firstPlace) {
			await increment(firstPlace, 'tahoiya-first-place');
		}

		for (const result of humanResults) {
			const {userId, score, isCorrect, deceived} = result;

			if (score >= 6) {
				await increment(userId, 'tahoiya-over-6');
			}
			if (score >= 10) {
				await increment(userId, 'tahoiya-over-10');
			}
			if (humanCount >= 3 && isCorrect) {
				await increment(userId, 'tahoiya-win');
			}
			if (!isCorrect && score > 0) {
				await increment(userId, 'tahoiya-positive-without-win');
			}
			if (deceived.length >= 1) {
				await increment(userId, 'tahoiya-deceive-once');
			}
			if (deceived.length >= 3) {
				await increment(userId, 'tahoiya-deceive-3-once');
			}
			if (deceived.length >= 5) {
				await increment(userId, 'tahoiya-5-bet');
			}
			await Promise.all(deceived.map(() => increment(userId, 'tahoiya-deceive')));

			const prev = this.#state.lastGameScore[userId];
			if (prev !== undefined && prev - score >= 5) {
				await increment(userId, 'tahoiya-down-10');
			}
			this.#state.lastGameScore[userId] = score;
		}

		for (const [userId, voteIndex] of Object.entries(game.votes)) {
			if (!userId.startsWith('U')) {
				continue;
			}
			const chosen = game.shuffledMeanings[voteIndex];
			if (chosen?.userId?.startsWith('tahoiyabot')) {
				await increment(userId, 'tahoiya-singularity');
			}
			if (chosen?.userId?.startsWith('U')) {
				const otherVoteIndex = game.votes[chosen.userId];
				if (otherVoteIndex !== undefined && game.shuffledMeanings[otherVoteIndex]?.userId === userId) {
					await increment(userId, 'tahoiya-deceive-each-other');
				}
			}
		}

		for (const change of ratingChanges) {
			if (!change.userId.startsWith('U')) {
				continue;
			}
			if (change.oldRating < 500 && change.newRating >= 500) {
				await increment(change.userId, 'tahoiya-rating-500');
			}
			if (change.oldRating < 800 && change.newRating >= 800) {
				await increment(change.userId, 'tahoiya-rating-800');
			}
		}
	}

	async #saveGameRecord(game: NormalGameState | DailyGameState, gameType: 'normal' | 'daily') {
		const theme = game.theme!;
		const record: GameRecord = {
			timestamp: Date.now(),
			theme: theme.type === 'dictionary' ? theme.ruby : theme.question,
			word: theme.type === 'dictionary' ? theme.word : theme.question,
			type: theme.type,
			sourceString: theme.type === 'dictionary' ? theme.sourceString : '',
			url: theme.sourceUrl,
			meanings: game.shuffledMeanings.map((m, i) => ({
				text: m.text,
				// eslint-disable-next-line no-nested-ternary
				type: m.isCorrect ? 'correct' : m.isDummy ? 'dummy' : 'user',
				...(m.userId && !m.isDummy ? {user: m.userId} : {}),
				...(m.isDummy && m.dummyWord ? {source: m.dummyWord[2]} : {}),
				voters: Object.entries(game.votes)
					.filter(([, voteIndex]) => voteIndex === i)
					.map(([user]) => ({user})),
			})),
			comments: [],
			author: gameType === 'daily' ? (game as DailyGameState).themeAuthor : null,
			participants: Object.keys(game.meanings).filter((u) => u.startsWith('U')),
		};

		try {
			if (db) {
				await db.collection('tahoiya_games').add(record);
			}
		} catch (err) {
			this.log.error('failed to save game record:', err);
		}
	}

	async #fetchAvailableThemes(): Promise<StoredTheme[]> {
		if (!db) {
			const available = [...this.#devThemes.values()].filter((t) => !t.used);
			const excluded = this.#state.authorHistory;
			const filtered = available.filter((t) => !excluded.includes(t.submittedBy));
			return shuffle(filtered.length > 0 ? filtered : available).slice(0, 1);
		}

		try {
			const excluded = this.#state.authorHistory;
			const snapshot = await db.collection('tahoiya_themes')
				.where('used', '==', false)
				.limit(30)
				.get();

			let themes: StoredTheme[] = snapshot.docs.map((d) => ({id: d.id, ...d.data()} as StoredTheme));
			const filtered = themes.filter((t) => !excluded.includes(t.submittedBy));
			if (filtered.length > 0) {
				themes = filtered;
			} else if (themes.length === 0) {
				this.#state.authorHistory = [];
				const retry = await db.collection('tahoiya_themes').where('used', '==', false).limit(30).get();
				themes = retry.docs.map((d) => ({id: d.id, ...d.data()} as StoredTheme));
			}

			return shuffle(themes).slice(0, 1);
		} catch (err) {
			this.log.error('failed to fetch themes:', err);
			return [];
		}
	}

	async #countAvailableThemes(): Promise<number> {
		if (!db) {
			return [...this.#devThemes.values()].filter((t) => !t.used).length;
		}

		try {
			const snapshot = await db.collection('tahoiya_themes').where('used', '==', false).count().get();
			return snapshot.data().count;
		} catch {
			return 0;
		}
	}

	async #markThemeUsed(themeId: string) {
		if (!db) {
			const theme = this.#devThemes.get(themeId);
			if (theme) {
				this.#devThemes.set(themeId, {...theme, used: true, usedAt: Date.now()});
			}
			return;
		}

		try {
			await db.collection('tahoiya_themes').doc(themeId).update({used: true, usedAt: Date.now()});
		} catch (err) {
			this.log.error('failed to mark theme used:', err);
		}
	}

	async #saveTheme(theme: StoredTheme) {
		if (!db) {
			this.#devThemes.set(theme.id, theme);
			this.log.info('Dev mode: theme saved in-memory:', theme.theme.type);
			return;
		}

		try {
			await db.collection('tahoiya_themes').doc(theme.id).set(theme);
		} catch (err) {
			this.log.error('failed to save theme:', err);
		}
	}

	#postMessage(options: {
		text: string;
		blocks?: KnownBlock[];
		channel?: string;
		threadTs?: string | null;
		broadcast?: boolean;
	}) {
		return this.slack.chat.postMessage({
			channel: options.channel ?? this.allowedChannels[0],
			username: this.username,
			icon_emoji: this.iconEmoji,
			text: options.text,
			unfurl_links: false,
			unfurl_media: false,
			...(options.blocks ? {blocks: options.blocks} : {}),
			...(options.threadTs ? {thread_ts: options.threadTs} : {}),
			...(options.broadcast ? {reply_broadcast: true as const} : {}),
		} as ChatPostMessageArguments);
	}
}

export default Tahoiya;
