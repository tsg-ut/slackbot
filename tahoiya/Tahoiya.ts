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
	GameComment,
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
	protected override wakeWordRegex = /^(?:たほいや|デイリーたほいや|たほいやランキング)$/;

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
			authorHistory: [],
		});

		this.#candidateWords = (await getCandidateWords()) as WordEntry[];

		this.#registerInteractions();

		scheduleJob('0 21 * * *', () => {
			mutex.runExclusive(() => this.#triggerDailyBetting());
		});

		// Restore timers
		if (this.#state.normalGame?.phase === 'collect_meanings') {
			const remaining = this.#state.normalGame.endPhaseAt - Date.now();
			setTimeout(
				() => mutex.runExclusive(() => this.#startNormalBettingsPhase()),
				Math.max(remaining, 0),
			);
		}

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
			await mutex.runExclusive(() => this.#updateDailyGameTheme());
		}

		this.log.info('Tahoiya initialized');
	}

	protected override onWakeWord(event: GenericMessageEvent, targetChannel: string): Promise<string | null> {
		const text = event.text?.trim();
		if (text === 'たほいや') {
			if (this.#state.normalGame !== null && this.#state.normalGame.phase !== 'select_theme') {
				return mutex.runExclusive(() => this.#postNormalGameStatus());
			}
			return mutex.runExclusive(() => this.#startNormalGame(event.user!, targetChannel));
		}
		if (text === 'デイリーたほいや') {
			return mutex.runExclusive(() => this.#showDailyStatus(targetChannel, null));
		}
		if (text === 'たほいやランキング') {
			return mutex.runExclusive(() => this.#showRanking(targetChannel));
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

		// Comment button: normal game
		this.messageClient.action({type: 'button', actionId: 'tahoiya_normal_comment_button'}, (payload: BlockButtonAction) => {
			type ViewWithState = {id?: string; state?: {values?: Record<string, unknown>}};
			const view = payload.view as ViewWithState;
			const rawValues = Object.values(view?.state?.values ?? {});
			const values = Object.assign({}, ...rawValues) as Record<string, {value?: string}>;
			const text = values?.comment_text?.value?.trim();
			const viewId = view?.id;
			if (text && viewId) {
				mutex.runExclusive(() => this.#submitComment('normal', payload.user.id, text, viewId)).catch((err) => this.log.error(err));
			}
		});

		// Comment button: daily game
		this.messageClient.action({type: 'button', actionId: 'tahoiya_daily_comment_button'}, (payload: BlockButtonAction) => {
			type ViewWithState = {id?: string; state?: {values?: Record<string, unknown>}};
			const view = payload.view as ViewWithState;
			const rawValues = Object.values(view?.state?.values ?? {});
			const values = Object.assign({}, ...rawValues) as Record<string, {value?: string}>;
			const text = values?.comment_text?.value?.trim();
			const viewId = view?.id;
			if (text && viewId) {
				mutex.runExclusive(() => this.#submitComment('daily', payload.user.id, text, viewId)).catch((err) => this.log.error(err));
			}
		});
	}

	async #startNormalGame(userId: string, channel: string): Promise<string | null> {
		if (this.#state.normalGame?.phase === 'select_theme') {
			const oldTs = this.#state.normalGame.gameMessageTs;
			if (oldTs) {
				await this.slack.chat.delete({
					channel: this.allowedChannels[0],
					ts: oldTs,
				}).catch((err) => this.log.error('failed to delete old candidates message:', err));
			}
		} else {
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
				meaningMessageTs: null,
				bettingMessageTs: null,
				statusMessageTs: null,
				startedAt: now,
				bettingPhaseStartedAt: null,
				comments: [],
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

		// Post collectMeaningMessage as thread reply (broadcast)
		const meaningResult = await this.#postThread('normal', {
			text: `たほいや「${theme.ruby}」の意味を登録してください！`,
			blocks: collectMeaningsMessage(this.#state.normalGame, 'normal'),
			broadcast: true,
		});
		this.#state.normalGame.meaningMessageTs = meaningResult?.ts ?? null;

		await this.#updateAllStatusMessages('normal');

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
					await this.#updateMeaningMessage();
					await this.#updateAllStatusMessages('normal');
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
			bettingPhaseStartedAt: Date.now(),
		};

		// Disable the meaning message thread reply
		await this.#disableMeaningMessage();

		// Post new betting message (mentions are now inside collectBettingsMessage blocks)
		const humanParticipants = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
		const mentions = humanParticipants.map((u) => `<@${u}>`).join(' ');
		const bettingResult = await this.#postThread('normal', {
			text: `たほいや投票フェーズ開始！${mentions ? `\n${mentions} 投票してください！` : ''}`,
			blocks: collectBettingsMessage(this.#state.normalGame, 'normal'),
			broadcast: true,
		});
		this.#state.normalGame.bettingMessageTs = bettingResult?.ts ?? null;

		await this.#updateAllStatusMessages('normal');

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
		await this.#publishComments(game, 'normal');
		await this.#grantAchievements(game, results, ratingChanges);
		await this.#saveGameRecord(game, 'normal');

		// Save TS values before clearing state, then update all with "ended" content
		const endedGameMessageTs = game.gameMessageTs;
		const endedStatusTs = game.statusMessageTs;
		const endedTheme = game.theme!;
		const endedThemeText = endedTheme.type === 'dictionary' ? `「${endedTheme.ruby}」` : `「${endedTheme.question}」`;
		const participantCount = Object.keys(game.meanings).filter((u) => u.startsWith('U')).length;
		const endedDetail = endedTheme.type === 'dictionary'
			? `お題: ${endedTheme.word}（${endedTheme.ruby}）\n正しい意味: ${endedTheme.meaning}\n参加者数: ${participantCount}人`
			: `お題: ${endedTheme.question}\n正解: ${endedTheme.answer}\n参加者数: ${participantCount}人`;
		const endedBlocks: KnownBlock[] = [
			{type: 'section', text: {type: 'mrkdwn', text: `たほいや ${endedThemeText} 終了\n${endedDetail}`}},
		];

		this.#state.normalGame = null;

		if (endedGameMessageTs) {
			await this.slack.chat.update({
				channel: this.allowedChannels[0],
				ts: endedGameMessageTs,
				text: 'たほいや（終了）',
				blocks: endedBlocks,
			}).catch((err) => this.log.error('failed to update ended game message:', err));
		}
		if (endedStatusTs) {
			await this.slack.chat.update({
				channel: this.allowedChannels[0],
				ts: endedStatusTs,
				text: 'たほいや（終了）',
				blocks: endedBlocks,
			}).catch((err) => this.log.error('failed to update ended status message:', err));
		}
	}

	async #updateDailyGameTheme(announce = false) {
		const theme = await this.#selectNextDailyTheme();

		if (!theme) {
			this.log.warn('No daily themes available');
			// Post standalone message (no thread to reply to)
			await this.#postMessage({text: '次のデイリーたほいやのお題が見つかりませんでした。お題を募集しています！'});
			return;
		}

		// Post collectMeaningMessage as the new parent message for this game
		const themeLabel = theme.theme.type === 'dictionary' ? `「${theme.theme.ruby}」` : `「${theme.theme.question}」`;
		const now = Date.now();

		// Temporary game state to render the message (endPhaseAt is 0 during collect_meanings — no fixed deadline)
		const tempGame: DailyGameState = {
			phase: 'collect_meanings',
			themeId: theme.id,
			themeAuthor: theme.submittedBy,
			theme: theme.theme,
			meanings: {},
			shuffledMeanings: [],
			votes: {},
			endPhaseAt: now,
			gameMessageTs: null,
			bettingMessageTs: null,
			statusMessageTs: null,
			startedAt: now,
			bettingPhaseStartedAt: null,
			comments: [],
		};

		const parentResult = await this.#postMessage({
			text: `デイリーたほいや ${themeLabel}`,
			blocks: collectMeaningsMessage(tempGame, 'daily'),
		});

		this.#state.dailyGame = {
			...tempGame,
			gameMessageTs: parentResult.ts ?? null,
		};

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
			await this.#postMessage({
				text: 'お題ストックが不足しているため、デイリーたほいやはスキップされました😢',
			});
			return;
		}

		const humanCount = Object.keys(game.meanings).filter((u) => u.startsWith('U')).length;
		if (humanCount < DAILY_TAHOIYA_MINIMUM_PARTICIPANTS) {
			const skipNotice = `参加者が${DAILY_TAHOIYA_MINIMUM_PARTICIPANTS}人未満のため、デイリーたほいやはスキップされました😢`;
			const themeCount = await this.#countAvailableThemes();
			const blocks = dailyStatusMessage(game, themeCount, skipNotice);
			await this.#postThread('daily', {text: skipNotice, blocks, broadcast: true});
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
			bettingPhaseStartedAt: Date.now(),
		};

		// Post collectBettingsMessage as thread reply (mentions are inside the blocks)
		const humanParticipants = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
		const mentions = humanParticipants.map((u) => `<@${u}>`).join(' ');
		const themeLabel = game.theme.type === 'dictionary'
			? `「${game.theme.ruby}」`
			: `「${game.theme.question}」`;

		const bettingResult = await this.#postThread('daily', {
			text: `デイリーたほいや ${themeLabel} の投票フェーズが始まりました！\n${mentions ? `${mentions} 60分以内に投票してください！` : ''}`,
			blocks: collectBettingsMessage(this.#state.dailyGame, 'daily'),
			broadcast: true,
		});
		this.#state.dailyGame.bettingMessageTs = bettingResult?.ts ?? null;

		// Update parent and all status messages to show current state (投票するボタン)
		await this.#updateAllStatusMessages('daily');

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
		await this.#publishComments(game, 'daily');
		await this.#grantAchievements(game, results, ratingChanges);
		await this.#saveGameRecord(game, 'daily');

		// Save TS values before clearing state, then start next game
		const endedGameMessageTs = game.gameMessageTs;
		const endedStatusTs = game.statusMessageTs;
		const endedTheme = game.theme;
		const endedThemeText = endedTheme.type === 'dictionary' ? `「${endedTheme.ruby}」` : `「${endedTheme.question}」`;
		const endedParticipantCount = Object.keys(game.meanings).filter((u) => u.startsWith('U')).length;
		const endedDetail = endedTheme.type === 'dictionary'
			? `お題: ${endedTheme.word}（${endedTheme.ruby}）\n正しい意味: ${endedTheme.meaning}\n参加者数: ${endedParticipantCount}人`
			: `お題: ${endedTheme.question}\n正解: ${endedTheme.answer}\n参加者数: ${endedParticipantCount}人`;
		const endedBlocks: KnownBlock[] = [
			{type: 'section', text: {type: 'mrkdwn', text: `デイリーたほいや ${endedThemeText} 終了\n${endedDetail}`}},
		];

		this.#state.dailyGame = null;

		await this.#updateDailyGameTheme(true);
		if (endedGameMessageTs) {
			await this.slack.chat.update({
				channel: this.allowedChannels[0],
				ts: endedGameMessageTs,
				text: 'デイリーたほいや（終了）',
				blocks: endedBlocks,
			}).catch((err) => this.log.error('failed to update ended daily game message:', err));
		}
		if (endedStatusTs) {
			await this.slack.chat.update({
				channel: this.allowedChannels[0],
				ts: endedStatusTs,
				text: 'デイリーたほいや（終了）',
				blocks: endedBlocks,
			}).catch((err) => this.log.error('failed to update ended daily status message:', err));
		}
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
		const userComments = (game.comments ?? []).filter((c) => c.user === userId);
		await this.slack.views.open({
			trigger_id: triggerId,
			view: submitMeaningModal(game.theme, gameType, existingMeaning, userComments),
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

		const userComments = (game.comments ?? []).filter((c) => c.user === userId);
		await this.slack.views.open({
			trigger_id: triggerId,
			view: bettingModal(game.shuffledMeanings, gameType, userId, userComments),
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

		const isEditing = userId in game.meanings;
		game.meanings[userId] = trimmed;

		if (gameType === 'normal') {
			await this.#updateMeaningMessage();
			await this.#updateAllStatusMessages('normal');
		} else {
			await this.#updateAllStatusMessages('daily');
		}

		if (userId.startsWith('U')) {
			await this.#postThread(gameType, {
				text: isEditing ? `<@${userId}> が意味を編集したよ✏️` : `<@${userId}> が意味を登録したよ👍️`,
			});
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

		await this.#updateBettingMessage(gameType);
		await this.#updateAllStatusMessages(gameType);

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
			await this.#updateDailyGameTheme(true);
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

		const isMimicryAllowed = values?.mimicry_allowed?.selected_options?.some((o) => o.value === 'allowed') ?? false;

		const stored: StoredTheme = {
			id: randomUUID(),
			submittedBy: userId,
			submittedAt: Date.now(),
			used: false,
			usedAt: null,
			theme: {type: 'arbitrary', question, answer, sourceUrl: url, isMimicryAllowed},
		};

		await this.#saveTheme(stored);
		await increment(userId, 'daily-tahoiya-theme');
		await increment(userId, 'tahoiya-arbitrary-theme');
		await this.#postMessage({text: `<@${userId}> がデイリーたほいやのお題を登録しました！`});
		if (this.#state.dailyGame === null) {
			await this.#updateDailyGameTheme(true);
		}
		return undefined;
	}

	async #showDailyStatus(channel: string, skipNotice: string | null): Promise<string | null> {
		const themeCount = await this.#countAvailableThemes();
		const blocks = dailyStatusMessage(this.#state.dailyGame, themeCount, skipNotice);

		if (this.#state.dailyGame?.gameMessageTs) {
			const oldStatusTs = this.#state.dailyGame.statusMessageTs;
			if (oldStatusTs) {
				await this.slack.chat.delete({
					channel: this.allowedChannels[0],
					ts: oldStatusTs,
				}).catch((err) => this.log.error('failed to delete old daily status message:', err));
				this.#state.dailyGame.statusMessageTs = null;
			}

			const result = await this.#postThread('daily', {
				text: 'デイリーたほいや',
				blocks,
				broadcast: true,
			});
			if (result?.ts) {
				this.#state.dailyGame.statusMessageTs = result.ts;
			}
			return result?.ts ?? null;
		}

		// No active game: post as standalone message
		const result = await this.#postMessage({channel, text: 'デイリーたほいや', blocks});
		return result.ts ?? null;
	}

	async #disableMeaningMessage() {
		const game = this.#state.normalGame;
		const ts = game?.meaningMessageTs ?? null;
		if (!game || !ts) {
			return;
		}

		await this.slack.chat.update({
			channel: this.allowedChannels[0],
			ts,
			text: 'たほいや 意味登録フェーズ（終了）',
			blocks: collectMeaningsMessage(game, 'normal', true),
		}).catch((err) => this.log.error('failed to disable meaning message:', err));
	}

	async #updateMeaningMessage() {
		const game = this.#state.normalGame;
		const ts = game?.meaningMessageTs ?? null;
		if (!game || !ts || game.phase !== 'collect_meanings') {
			return;
		}

		await this.slack.chat.update({
			channel: this.allowedChannels[0],
			ts,
			text: 'たほいや 意味登録フェーズ',
			blocks: collectMeaningsMessage(game, 'normal'),
		}).catch((err) => this.log.error('failed to update meaning message:', err));
	}

	async #postNormalGameStatus(): Promise<string | null> {
		const game = this.#state.normalGame;
		if (!game) {
			return null;
		}

		if (game.statusMessageTs) {
			await this.slack.chat.delete({
				channel: this.allowedChannels[0],
				ts: game.statusMessageTs,
			}).catch((err) => this.log.error('failed to delete old normal status message:', err));
			game.statusMessageTs = null;
		}

		const blocks = this.#getNormalGameStatusBlocks(game);
		const result = await this.#postThread('normal', {
			text: 'たほいや（ゲーム進行中）',
			blocks,
			broadcast: true,
		});
		if (result?.ts) {
			game.statusMessageTs = result.ts;
		}
		return result?.ts ?? null;
	}

	#getNormalGameStatusBlocks(game: NormalGameState): KnownBlock[] {
		if (game.phase === 'select_theme') {
			return candidatesMessage(game.candidates);
		}

		const theme = game.theme!;
		const themeText = theme.type === 'dictionary' ? `「${theme.ruby}」` : `「${theme.question}」`;

		if (game.phase === 'collect_meanings') {
			const humanMeaningUsers = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
			const submittedText = humanMeaningUsers.length > 0
				? `${humanMeaningUsers.map((u) => `<@${u}>`).join(' ')} (${humanMeaningUsers.length}人)`
				: 'まだ誰も登録していません';
			return [
				{type: 'section', text: {type: 'mrkdwn', text: `たほいや ${themeText} 意味登録中\n登録済み: ${submittedText}`}},
				{
					type: 'actions',
					elements: [{
						type: 'button',
						text: {type: 'plain_text', text: '意味を登録する', emoji: true},
						action_id: 'tahoiya_normal_submit_meaning_button',
						style: 'primary',
					}],
				},
			];
		}

		if (game.phase === 'collect_bettings') {
			const humanVoteUsers = Object.keys(game.votes).filter((u) => u.startsWith('U'));
			const votedText = humanVoteUsers.length > 0
				? `${humanVoteUsers.map((u) => `<@${u}>`).join(' ')} (${humanVoteUsers.length}人)`
				: 'まだ誰も投票していません';
			return [
				{type: 'section', text: {type: 'mrkdwn', text: `たほいや ${themeText} 投票中\n投票済み: ${votedText}`}},
				{
					type: 'actions',
					elements: [{
						type: 'button',
						text: {type: 'plain_text', text: '投票する', emoji: true},
						action_id: 'tahoiya_normal_bet_button',
						style: 'primary',
					}],
				},
			];
		}

		// Game ended or unknown phase
		const themeDisplay = theme.type === 'dictionary' ? `「${theme.ruby}」` : `「${theme.question}」`;
		return [{type: 'section', text: {type: 'mrkdwn', text: `たほいや ${themeDisplay} 終了`}}];
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

	async #updateAllStatusMessages(gameType: 'normal' | 'daily') {
		if (gameType === 'normal') {
			const game = this.#state.normalGame;
			if (!game) {
				return;
			}

			const blocks = this.#getNormalGameStatusBlocks(game);

			const tssToUpdate = [game.gameMessageTs, game.statusMessageTs].filter((ts): ts is string => ts !== null);
			for (const ts of tssToUpdate) {
				await this.slack.chat.update({
					channel: this.allowedChannels[0],
					ts,
					text: 'たほいや',
					blocks,
				}).catch((err) => this.log.error('failed to update status message:', err));
			}
		} else {
			const game = this.#state.dailyGame;
			if (!game) {
				return;
			}

			let blocks: KnownBlock[] = [];
			if (game.phase === 'collect_meanings') {
				blocks = collectMeaningsMessage(game, 'daily');
			} else {
				const themeCount = await this.#countAvailableThemes();
				blocks = dailyStatusMessage(game, themeCount, null);
			}

			const tssToUpdate = [game.gameMessageTs, game.statusMessageTs].filter((ts): ts is string => ts !== null);
			for (const ts of tssToUpdate) {
				await this.slack.chat.update({
					channel: this.allowedChannels[0],
					ts,
					text: 'デイリーたほいや',
					blocks,
				}).catch((err) => this.log.error('failed to update status message:', err));
			}
		}
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

		const topRatingUserId = maxBy(
			Object.keys(this.#state.ratings).filter((u) => u.startsWith('U')),
			(u) => this.#state.ratings[u],
		);
		if (topRatingUserId) {
			await increment(topRatingUserId, 'tahoiya-first-place');
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
			comments: game.comments ?? [],
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

	async #showRanking(channel: string): Promise<string | null> {
		const entries = Object.entries(this.#state.ratings)
			.filter(([userId]) => userId.startsWith('U'))
			.sort(([, a], [, b]) => b - a)
			.slice(0, 20);

		if (entries.length === 0) {
			const result = await this.#postMessage({channel, text: 'まだレーティングデータがありません。'});
			return result.ts ?? null;
		}

		const lines = entries.map(([userId, rating], idx) => {
			const games = this.#state.gamesPlayed[userId] ?? 0;
			return `${idx + 1}位: <@${userId}> - ${Math.round(rating)}pt（${games}ゲーム）`;
		});

		const result = await this.#postMessage({
			channel,
			text: `たほいやランキング :trophy:\n${lines.join('\n')}`,
		});
		return result.ts ?? null;
	}

	async #submitComment(gameType: 'normal' | 'daily', userId: string, text: string, viewId: string) {
		const game = gameType === 'normal' ? this.#state.normalGame : this.#state.dailyGame;
		if (!game) {
			return;
		}

		const comment: GameComment = {user: userId, text, timestamp: Date.now()};
		game.comments.push(comment);

		const userComments = game.comments.filter((c: GameComment) => c.user === userId);

		if (game.phase === 'collect_meanings' && game.theme) {
			const view = submitMeaningModal(game.theme, gameType, game.meanings[userId], userComments);
			await this.slack.views.update({view_id: viewId, view}).catch((err) => this.log.error('failed to update modal after comment:', err));
		} else if (game.phase === 'collect_bettings') {
			const view = bettingModal(game.shuffledMeanings, gameType, userId, userComments);
			await this.slack.views.update({view_id: viewId, view}).catch((err) => this.log.error('failed to update modal after comment:', err));
		}
	}

	async #publishComments(game: NormalGameState | DailyGameState, gameType: 'normal' | 'daily') {
		const comments = game.comments ?? [];
		if (comments.length === 0) {
			return;
		}

		const bettingStart = game.bettingPhaseStartedAt ?? null;
		const lines: string[] = [];
		let insertedSeparator = bettingStart === null;

		for (const c of comments) {
			if (!insertedSeparator && c.timestamp >= bettingStart!) {
				lines.push('〜投票フェーズ開始〜');
				insertedSeparator = true;
			}
			lines.push(`<@${c.user}>: ${c.text}`);
		}

		if (!insertedSeparator) {
			lines.push('〜投票フェーズ開始〜');
		}

		await this.#postThread(gameType, {text: `ゲーム中のコメント:\n${lines.join('\n')}`});
	}

	async #selectNextDailyTheme(): Promise<StoredTheme | null> {
		if (!db) {
			const available = [...this.#devThemes.values()].filter((t) => !t.used);
			if (available.length === 0) {
				return null;
			}
			const neverSelected = available.filter((t) => !this.#state.authorHistory.includes(t.submittedBy));
			if (neverSelected.length > 0) {
				return sample(neverSelected) ?? null;
			}
			for (const authorId of this.#state.authorHistory) {
				const authorThemes = available.filter((t) => t.submittedBy === authorId);
				if (authorThemes.length > 0) {
					return sample(authorThemes) ?? null;
				}
			}
			return sample(available) ?? null;
		}

		try {
			const snapshot = await db.collection('tahoiya_themes')
				.where('used', '==', false)
				.limit(30)
				.get();

			const themes: StoredTheme[] = snapshot.docs.map((d) => ({id: d.id, ...d.data()} as StoredTheme));
			if (themes.length === 0) {
				return null;
			}

			const neverSelected = themes.filter((t) => !this.#state.authorHistory.includes(t.submittedBy));
			if (neverSelected.length > 0) {
				return sample(neverSelected) ?? null;
			}

			for (const authorId of this.#state.authorHistory) {
				const authorThemes = themes.filter((t) => t.submittedBy === authorId);
				if (authorThemes.length > 0) {
					return sample(authorThemes) ?? null;
				}
			}

			return sample(themes) ?? null;
		} catch (err) {
			this.log.error('failed to fetch themes:', err);
			return null;
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
