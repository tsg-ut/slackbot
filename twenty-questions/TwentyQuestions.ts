import {randomUUID} from 'crypto';
import type EventEmitter from 'events';
import type {BlockAction, ViewSubmitAction} from '@slack/bolt';
import type {SlackMessageAdapter} from '@slack/interactive-messages';
import type {WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {sampleSize, sample} from 'lodash';
import logger from '../lib/logger';
import openai from '../lib/openai';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import db from '../lib/firestore';
import {firestore} from 'firebase-admin';
import {getCandidateWords} from '../tahoiya/lib';
import {increment} from '../achievements';
import gameStatusMessage from './views/gameStatusMessage';
import playerModal from './views/playerModal';
import gameLogModal from './views/gameLogModal';

const mutex = new Mutex();
const log = logger.child({bot: 'twenty-questions'});

const GAME_TIMEOUT = 30 * 60 * 1000;
const MAX_QUESTIONS = 20;

export interface Question {
	question: string;
	answer: string;
	timestamp: number;
	isAnswerAttempt?: boolean;
	isCorrect?: boolean;
}

export interface PlayerState {
	userId: string;
	questions: Question[];
	questionCount: number;
	isFinished: boolean;
	score: number | null;
}

export interface GameState {
	id: string;
	topic: string;
	status: 'active' | 'finished';
	startedAt: number;
	finishedAt: number | null;
	players: {[userId: string]: PlayerState};
	statusMessageTs: string | null;
}

export interface StateObj {
	uuid: string;
	currentGame: GameState | null;
}

export interface FinishedGame {
	id: string;
	topic: string;
	startedAt: firestore.Timestamp;
	finishedAt: firestore.Timestamp;
	players: {
		userId: string;
		questionCount: number;
		score: number | null;
		questions: Question[];
	}[];
}

export class TwentyQuestions {
	#slack: WebClient;

	#interactions: SlackMessageAdapter;

	#state: StateObj;

	#SANDBOX_ID = process.env.CHANNEL_SANDBOX ?? '';

	static async create(slack: SlackInterface) {
		log.info('Creating twenty-questions bot instance');

		const state = await State.init<StateObj>('twenty-questions', {
			uuid: randomUUID(),
			currentGame: null,
		});

		return new TwentyQuestions(slack, state);
	}

	constructor(slack: SlackInterface, state: StateObj) {
		this.#slack = slack.webClient;
		this.#interactions = slack.messageClient;
		this.#state = state;

		if (!this.#SANDBOX_ID || this.#SANDBOX_ID === 'CXXXXXXXX') {
			throw new Error('CHANNEL_SANDBOX環境変数が設定されていません');
		}

		this.#interactions.action({
			type: 'button',
			actionId: new RegExp(`^twenty_questions_${this.#state.uuid}_join_button$`),
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked the join button`);
			mutex.runExclusive(() => this.handleJoinButton(payload));
		});

		this.#interactions.viewSubmission(
			new RegExp(`^twenty_questions_${this.#state.uuid}_player_modal$`),
			(payload: ViewSubmitAction) => {
				log.info(`${payload.user.name} submitted player modal`);
				mutex.runExclusive(() => this.handleModalSubmit(payload));
			},
		);

		this.#interactions.action({
			type: 'button',
			actionId: new RegExp(`^twenty_questions_${this.#state.uuid}_submit_question$`),
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked submit question button`);
			mutex.runExclusive(() => this.handleQuestionSubmit(payload));
		});

		this.#interactions.action({
			type: 'button',
			actionId: new RegExp(`^twenty_questions_${this.#state.uuid}_submit_answer$`),
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked submit answer button`);
			mutex.runExclusive(() => this.handleAnswerSubmit(payload));
		});

		this.#interactions.action({
			type: 'button',
			actionId: new RegExp(`^twenty_questions_${this.#state.uuid}_view_log_button$`),
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked view log button`);
			this.handleViewLogButton(payload);
		});

		if (this.#state.currentGame) {
			this.scheduleGameEnd(this.#state.currentGame);
		}
	}

	public async startGame(userId: string) {
		if (this.#state.currentGame && this.#state.currentGame.status === 'active') {
			await this.#slack.chat.postEphemeral({
				channel: this.#SANDBOX_ID,
				user: userId,
				text: '既に進行中のゲームがあります。',
			});
			return;
		}

		log.info('Starting new game');

		// お題を選択中であることをユーザーに通知
		await this.#slack.chat.postEphemeral({
			channel: this.#SANDBOX_ID,
			user: userId,
			text: 'お題を選択中です⋯⋯',
		});

		const topic = await this.selectTopic();
		log.info(`Selected topic: ${topic}`);

		const gameId = randomUUID();
		const now = Date.now();

		const newGame: GameState = {
			id: gameId,
			topic,
			status: 'active',
			startedAt: now,
			finishedAt: null,
			players: {},
			statusMessageTs: null,
		};

		this.#state.currentGame = newGame;

		const result = await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			text: '20の扉ゲーム開始！',
			blocks: gameStatusMessage(this.#state),
			username: '20の扉',
			icon_emoji: ':door:',
		});

		this.#state.currentGame.statusMessageTs = result.ts;

		this.scheduleGameEnd(newGame);
	}

	private async selectTopic(): Promise<string> {
		log.info('Selecting topic from candidate words');

		const candidateWords = await getCandidateWords({min: 2, max: 10});

		// Step 1: 200個の候補から選ぶ処理を10回繰り返す
		const selectedWords: string[] = [];
		for (let i = 0; i < 10; i++) {
			const sampledWords = sampleSize(candidateWords, 200);
			const wordList = sampledWords.map(([word]) => word).join(' / ');

			const completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content:
							'あなたは「20の扉」ゲームのお題を選ぶアシスタントです。' +
							'提供された単語リストから、以下の条件を満たす最適な単語を1つ選んでください：\n' +
							'1. 名詞であること\n' +
							'2. 具体的な実体があるものを指す単語であること\n' +
							'3. 複合語(例: 「電気自動車」「あじさい園」「りんご売り」など)は避けること\n' +
							'4. なるべく簡単で、多くの人が知っている単語であること\n' +
							'単語のみを回答してください。説明は不要です。',
					},
					{
						role: 'user',
						content: `単語リスト: ${wordList}`,
					},
				],
				max_tokens: 50,
			});

			const selected = completion.choices[0]?.message?.content?.trim() || sampledWords[0][0];
			selectedWords.push(selected);
			log.info(`Round ${i + 1}/10: Selected "${selected}"`);
		}

		// Step 2: 得られた10個の単語からさらに最適な1つを選ぶ
		const finalWordList = selectedWords.join(' / ');
		const finalCompletion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content:
						'あなたは「20の扉」ゲームのお題を選ぶアシスタントです。' +
						'提供された単語リストから、以下の条件を全て満たす単語のみを抽出し、スラッシュ (/) で区切ってください：\n' +
						'1. 名詞であること\n' +
						'2. 具体的な実体があるものを指す単語であること\n' +
						'3. 複合語(例: 「電気自動車」「あじさい園」「りんご売り」など)は避けること\n' +
						'4. なるべく簡単で、多くの人が知っている単語であること\n' +
						'抽出された単語リストのみを回答してください。説明は不要です。',
				},
				{
					role: 'user',
					content: `単語リスト: ${finalWordList}`,
				},
			],
			max_tokens: 50,
		});

		const output = finalCompletion.choices[0]?.message?.content?.trim() || finalWordList;
		const candidates = output.split('/').map((w) => w.trim()).filter((w) => w.length > 0);
		log.info(`Final candidates: ${candidates}`);

		const topic = sample(candidates);
		log.info(`Final selected topic: ${topic} (from candidates: ${finalWordList})`);

		if (!topic) {
			throw new Error('トピックの選択に失敗しました');
		}

		return topic;
	}

	private scheduleGameEnd(game: GameState) {
		const timeUntilEnd = game.startedAt + GAME_TIMEOUT - Date.now();

		if (timeUntilEnd <= 0) {
			mutex.runExclusive(() => this.endGame());
			return;
		}

		setTimeout(() => {
			mutex.runExclusive(() => this.endGame());
		}, timeUntilEnd);
	}

	private async endGame() {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		log.info('Ending game');

		this.#state.currentGame.status = 'finished';
		this.#state.currentGame.finishedAt = Date.now();

		await this.updateStatusMessage();

		await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
			reply_broadcast: true,
			text: `ゲーム終了！お題は「${this.#state.currentGame.topic}」でした。`,
			username: '20の扉',
			icon_emoji: ':door:',
		});

		// ランキング1位の実績を付与
		const correctPlayers = Object.values(this.#state.currentGame.players)
			.filter((p) => p.score !== null)
			.sort((a, b) => a.score! - b.score!);

		if (correctPlayers.length > 0) {
			// 同率1位のプレイヤーを全て取得
			const bestScore = correctPlayers[0].score!;
			const firstPlacePlayers = correctPlayers.filter((p) => p.score === bestScore);

			// 参加者数を計算
			const participantCount = Object.values(this.#state.currentGame.players).filter(
				(p) => p.questionCount > 0,
			).length;

			// 1位の全プレイヤーに実績を付与
			for (const player of firstPlacePlayers) {
				await increment(player.userId, 'twenty-questions-first-place');

				// 5人以上参加している場合
				if (participantCount >= 5) {
					await increment(player.userId, 'twenty-questions-first-place-5plus-players');
				}
			}
		}

		await this.saveGameToFirestore(this.#state.currentGame);
	}

	private async saveGameToFirestore(game: GameState) {
		const gamesCollection = db.collection('twenty_questions_games');

		const players = Object.values(game.players).map((player) => ({
			userId: player.userId,
			questionCount: player.questionCount,
			score: player.score,
			questions: player.questions,
		}));

		const finishedGame: FinishedGame = {
			id: game.id,
			topic: game.topic,
			startedAt: firestore.Timestamp.fromMillis(game.startedAt),
			finishedAt: firestore.Timestamp.fromMillis(game.finishedAt!),
			players,
		};

		await gamesCollection.add(finishedGame);
		log.info(`Game ${game.id} saved to Firestore`);
	}

	private async handleJoinButton(payload: BlockAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			await this.#slack.chat.postEphemeral({
				channel: payload.channel?.id ?? this.#SANDBOX_ID,
				user: payload.user.id,
				text: '現在進行中のゲームはありません。',
			});
			return;
		}

		const userId = payload.user.id;

		if (!this.#state.currentGame.players[userId]) {
			this.#state.currentGame.players[userId] = {
				userId,
				questions: [],
				questionCount: 0,
				isFinished: false,
				score: null,
			};

			await increment(userId, 'twenty-questions-participate');
		}

		const player = this.#state.currentGame.players[userId];

		await this.#slack.views.open({
			trigger_id: payload.trigger_id,
			view: playerModal(this.#state, player),
		});
	}

	private async handleViewLogButton(payload: BlockAction) {
		if (!this.#state.currentGame) {
			await this.#slack.chat.postEphemeral({
				channel: payload.channel?.id ?? this.#SANDBOX_ID,
				user: payload.user.id,
				text: '現在進行中のゲームはありません。',
			});
			return;
		}

		await this.#slack.views.open({
			trigger_id: payload.trigger_id,
			view: gameLogModal(this.#state),
		});
	}

	private async handleModalSubmit(payload: ViewSubmitAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		const userId = payload.user.id;
		const player = this.#state.currentGame.players[userId];

		if (!player || player.isFinished) {
			return;
		}

		// 質問回数が19回以上の場合は答えの送信のみ受け付ける
		if (player.questionCount >= 19) {
			const answerInput = payload.view?.state?.values?.answer_input?.answer_input_field;
			const answer = answerInput?.value?.trim();

			if (answer) {
				await this.handleAnswer(userId, player, answer, payload.view?.id);
			}
			return;
		}

		// 質問の送信
		const questionInput = payload.view?.state?.values?.question_input?.question_input_field;
		const question = questionInput?.value?.trim();

		if (question) {
			await this.handleQuestion(userId, player, question, payload.view?.id);
		}
	}

	private async handleQuestionSubmit(payload: BlockAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		const userId = payload.user.id;
		const player = this.#state.currentGame.players[userId];

		if (!player || player.isFinished) {
			return;
		}

		const questionInput = payload.view?.state?.values?.question_input?.question_input_field;
		const question = questionInput?.value?.trim();

		if (!question) {
			return;
		}

		await this.handleQuestion(userId, player, question, payload.view?.id);
	}

	private async handleAnswerSubmit(payload: BlockAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		const userId = payload.user.id;
		const player = this.#state.currentGame.players[userId];

		if (!player || player.isFinished) {
			return;
		}

		const answerInput = payload.view?.state?.values?.answer_input?.answer_input_field;
		const answer = answerInput?.value?.trim();

		if (!answer) {
			return;
		}

		await this.handleAnswer(userId, player, answer, payload.view?.id);
	}

	private async handleQuestion(userId: string, player: PlayerState, question: string, viewId?: string) {
		if (!this.#state.currentGame) {
			return;
		}

		// 長さ制限のチェック
		if (question.length > 30) {
			log.warn(`Question too long: ${question.length} characters`);
			return;
		}

		const topic = this.#state.currentGame.topic;

		const completion = await openai.chat.completions.create({
			model: 'gpt-5-mini',
			messages: [
				{
					role: 'system',
					content:
						`あなたは「20の扉」ゲームのアシスタントです。お題は「${topic}」です。\n` +
						`\n` +
						`プレイヤーからの質問に対して、以下のいずれか一つのみで答えてください：\n` +
						`- はい\n` +
						`- いいえ\n` +
						`- どちらかと言えばはい\n` +
						`- どちらかと言えばいいえ\n` +
						`- わかりません\n` +
						`- 答えられません\n` +
						`\n` +
						`重要な注意事項：\n` +
						`- 「はい」または「いいえ」で答えられない質問（例：「答えはなんですか？」「中身は何ですか？」など）には必ず「答えられません」と答えてください\n` +
						`- 上記の6つの選択肢以外の回答は絶対にしないでください\n` +
						`- 説明や補足は一切不要です\n` +
						`- 句点（。）は付けても付けなくても構いません`,
				},
				...player.questions.filter((q) => !q.isAnswerAttempt).map((q) => [
					{role: 'user' as const, content: q.question},
					{role: 'assistant' as const, content: q.answer},
				]).flat(),
				{
					role: 'user',
					content: question,
				},
			],
			max_tokens: 50,
		});

		const rawAnswer = completion.choices[0]?.message?.content?.trim() || 'わかりません';
		const aiAnswer = this.validateAIResponse(rawAnswer);

		await increment(userId, 'twenty-questions-ask-question');

		// 重複質問のチェック
		const actualQuestions = player.questions.filter((q) => !q.isAnswerAttempt);
		const duplicateIndices = actualQuestions
			.map((q, index) => (q.question === question ? index : -1))
			.filter((index) => index !== -1);

		if (duplicateIndices.length > 0) {
			await increment(userId, 'twenty-questions-duplicate-question');

			// 異なる回答を得た場合
			if (duplicateIndices.some((duplicateIndex) => actualQuestions[duplicateIndex].answer !== aiAnswer)) {
				await increment(userId, 'twenty-questions-duplicate-question-different-answer');
			}

			// 10問以上前の質問と重複
			if (duplicateIndices.some((duplicateIndex) => duplicateIndex < actualQuestions.length - 10)) {
				await increment(userId, 'twenty-questions-duplicate-question-10plus-ago');
			}

			// 直前の質問と重複
			if (duplicateIndices.some((duplicateIndex) => duplicateIndex === actualQuestions.length - 1)) {
				await increment(userId, 'twenty-questions-duplicate-question-consecutive');
			}
		}

		player.questions.push({
			question,
			answer: aiAnswer,
			timestamp: Date.now(),
			isAnswerAttempt: false,
		});
		player.questionCount++;

		if (viewId) {
			await this.updatePlayerModal(viewId, player);
		}

		if (player.questionCount >= MAX_QUESTIONS) {
			await this.finishPlayer(userId, player, false);
		}

		await this.updateStatusMessage();
	}

	private async handleAnswer(userId: string, player: PlayerState, answer: string, viewId?: string) {
		if (!this.#state.currentGame) {
			return;
		}

		// 長さ制限のチェック
		if (answer.length > 15) {
			log.warn(`Answer too long: ${answer.length} characters`);
			return;
		}

		const topic = this.#state.currentGame.topic;

		player.questionCount++;

		const completion = await openai.chat.completions.create({
			model: 'gpt-5-mini',
			messages: [
				{
					role: 'system',
					content:
						`あなたは「20の扉」ゲームの回答を判定するアシスタントです。` +
						`お題は「${topic}」です。` +
						`プレイヤーの答え「${answer}」がお題と同一であるかどうかを判定してください。` +
						`「YES」または「NO」のみで答えてください。説明は不要です。`,
				},
				{
					role: 'user',
					content: `プレイヤーの答え: ${answer}\nお題: ${topic}\n同一ですか？`,
				},
			],
			max_tokens: 10,
		});

		log.info(`Answer evaluation completion: ${JSON.stringify(completion.choices[0]?.message)}`);

		const isCorrect =
			!answer.toUpperCase().includes('YES') &&
			completion.choices[0]?.message?.content?.trim().toUpperCase() === 'YES';

		player.questions.push({
			question: `答え: ${answer}`,
			answer: isCorrect ? '正解！' : '不正解',
			timestamp: Date.now(),
			isAnswerAttempt: true,
			isCorrect,
		});

		if (viewId) {
			await this.updatePlayerModal(viewId, player);
		}

		if (isCorrect) {
			await this.finishPlayer(userId, player, true);
		} else if (player.questionCount >= MAX_QUESTIONS) {
			await this.finishPlayer(userId, player, false);
		}
	}

	private async finishPlayer(userId: string, player: PlayerState, isCorrect: boolean) {
		if (!this.#state.currentGame) {
			return;
		}

		player.isFinished = true;
		player.score = isCorrect ? player.questionCount : null;

		if (isCorrect) {
			await this.#slack.chat.postMessage({
				channel: this.#SANDBOX_ID,
				thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
				reply_broadcast: true,
				text: `<@${userId}> が ${player.questionCount} 問で正解しました！おめでとうございます！🎉`,
				username: '20の扉',
				icon_emoji: ':door:',
			});

			await increment(userId, 'twenty-questions-correct');
			await increment(userId, `twenty-questions-correct-${player.questionCount}`);

			if (player.questionCount <= 10) {
				await increment(userId, 'twenty-questions-correct-within-10');
			}

			if (player.questionCount <= 15) {
				await increment(userId, 'twenty-questions-correct-within-15');
			}

			const actualQuestions = player.questions.filter((q) => !q.isAnswerAttempt);

			if (actualQuestions.length > 0) {
				// すべて「はい」で正解
				const allYes = actualQuestions.every((q) => q.answer === 'はい');
				if (allYes) {
					await increment(userId, 'twenty-questions-correct-all-yes');
				}

				// すべて「いいえ」で正解
				const allNo = actualQuestions.every((q) => q.answer === 'いいえ');
				if (allNo) {
					await increment(userId, 'twenty-questions-correct-all-no');
				}

				// 「わかりません」が5回以上
				const wakaranaiCount = actualQuestions.filter((q) => q.answer === 'わかりません').length;
				if (wakaranaiCount >= 5) {
					await increment(userId, 'twenty-questions-correct-5plus-wakaranai');
				}

				// 「答えられません」が5回以上
				const kotaerarenaiCount = actualQuestions.filter((q) => q.answer === '答えられません').length;
				if (kotaerarenaiCount >= 5) {
					await increment(userId, 'twenty-questions-correct-5plus-kotaerarenai');
				}
			}
		} else {
			await this.#slack.chat.postMessage({
				channel: this.#SANDBOX_ID,
				thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
				reply_broadcast: true,
				text: `<@${userId}> が質問回数の上限に達しました`,
				username: '20の扉',
				icon_emoji: ':door:',
			});

			await this.#slack.chat.postEphemeral({
				channel: this.#SANDBOX_ID,
				user: userId,
				text: `残念！正解は「${this.#state.currentGame.topic}」でした。`,
			});

			await increment(userId, 'twenty-questions-fail');
		}

		await this.updateStatusMessage();
	}

	private async updateStatusMessage() {
		if (!this.#state.currentGame || !this.#state.currentGame.statusMessageTs) {
			return;
		}

		await this.#slack.chat.update({
			channel: this.#SANDBOX_ID,
			ts: this.#state.currentGame.statusMessageTs,
			text: '20の扉ゲーム',
			blocks: gameStatusMessage(this.#state),
		});
	}

	private async updatePlayerModal(viewId: string, player: PlayerState) {
		try {
			await this.#slack.views.update({
				view_id: viewId,
				view: playerModal(this.#state, player),
			});
		} catch (error) {
			// expired_trigger_idなどのエラーは無視（モーダルが既に閉じている可能性がある）
			log.warn(`Failed to update modal: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private validateAIResponse(response: string): string {
		const normalized = response.replace(/[。、]/g, '').trim();

		const validResponses = [
			'はい',
			'いいえ',
			'どちらかと言えばはい',
			'どちらかと言えばいいえ',
			'わかりません',
			'答えられません',
		];

		if (validResponses.includes(normalized)) {
			return normalized;
		}

		log.warn(`Invalid AI response: "${response}", replacing with "答えられません"`);
		return '答えられません';
	}
}
