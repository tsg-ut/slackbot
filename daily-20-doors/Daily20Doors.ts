import {randomUUID} from 'crypto';
import type EventEmitter from 'events';
import type {BlockAction, ViewSubmitAction} from '@slack/bolt';
import type {SlackMessageAdapter} from '@slack/interactive-messages';
import type {WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import logger from '../lib/logger';
import openai from '../lib/openai';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';

export interface DailyWord {
	word: string;
	reading: string;
	date: string; // YYYY-MM-DD format
}

export interface UserAttempt {
	userId: string;
	date: string; // YYYY-MM-DD format
	questions: string[];
	responses: string[];
	completed: boolean;
	correctGuess?: string;
	questionCount: number;
}

export interface StateObj {
	uuid: string;
	currentWord: DailyWord | null;
	userAttempts: UserAttempt[];
}

const mutex = new Mutex();
const log = logger.child({bot: 'daily-20-doors'});

// Sample Japanese words for daily challenges
const SAMPLE_WORDS: Omit<DailyWord, 'date'>[] = [
	{word: 'バナナ', reading: 'ばなな'},
	{word: '新幹線', reading: 'しんかんせん'},
	{word: 'カレーパン', reading: 'かれーぱん'},
	{word: '図書館', reading: 'としょかん'},
	{word: 'コンビニ', reading: 'こんびに'},
	{word: '桜', reading: 'さくら'},
	{word: '電車', reading: 'でんしゃ'},
	{word: 'ラーメン', reading: 'らーめん'},
	{word: '携帯電話', reading: 'けいたいでんわ'},
	{word: '自転車', reading: 'じてんしゃ'},
];

export class Daily20Doors {
	#slack: WebClient;

	#interactions: SlackMessageAdapter;

	#eventClient: EventEmitter;

	#state: StateObj;

	#SANDBOX_ID = process.env.CHANNEL_SANDBOX ?? '';

	static async create(slack: SlackInterface) {
		log.info('Creating daily-20-doors bot instance');

		const state = await State.init<StateObj>('daily-20-doors', {
			uuid: randomUUID(),
			currentWord: null,
			userAttempts: [],
		});

		return new Daily20Doors(slack, state);
	}

	constructor(slack: SlackInterface, state: StateObj) {
		this.#slack = slack.webClient;
		this.#interactions = slack.messageClient;
		this.#eventClient = slack.eventClient;
		this.#state = state;

		if (!this.#SANDBOX_ID || this.#SANDBOX_ID === 'CXXXXXXXX') {
			throw new Error('CHANNEL_SANDBOX環境変数が設定されていません');
		}
	}

	async initialize() {
		await this.ensureDailyWord();

		// Register interaction handlers
		this.#interactions.action({
			type: 'button',
			actionId: `daily20doors_${this.#state.uuid}_start_game`,
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} started the daily challenge`);
			mutex.runExclusive(() => (
				this.startUserChallenge(payload.user.id, payload.trigger_id)
			));
		});

		this.#interactions.viewSubmission(`daily20doors_${this.#state.uuid}_question_dialog`, (payload: ViewSubmitAction) => {
			log.debug(`${payload.user.name} submitted a question`);

			const stateObjects = Object.values(payload.view.state.values ?? {});
			const stateValues = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.handleUserQuestion({
					userId: payload.user.id,
					question: stateValues.question_input?.value || '',
					viewId: payload.view.id,
				})
			));
		});

		this.#interactions.action({
			type: 'button',
			actionId: `daily20doors_${this.#state.uuid}_make_guess`,
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} wants to make a guess`);
			mutex.runExclusive(() => (
				this.showGuessDialog(payload.user.id, payload.trigger_id)
			));
		});

		this.#interactions.viewSubmission(`daily20doors_${this.#state.uuid}_guess_dialog`, (payload: ViewSubmitAction) => {
			const stateObjects = Object.values(payload.view.state.values ?? {});
			const stateValues = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.handleUserGuess({
					userId: payload.user.id,
					guess: stateValues.guess_input?.value || '',
				})
			));
		});

		log.info('Daily 20 Doors bot initialized');
	}

	private ensureDailyWord() {
		const [today] = new Date().toISOString().split('T'); // YYYY-MM-DD

		if (!this.#state.currentWord || this.#state.currentWord.date !== today) {
			// Select a new word for today
			const wordIndex = this.getDayBasedIndex(today);
			const selectedWord = SAMPLE_WORDS[wordIndex % SAMPLE_WORDS.length];

			this.#state.currentWord = {
				...selectedWord,
				date: today,
			};

			log.info(`Selected daily word for ${today}: ${selectedWord.word}`);

			// Reset user attempts for the new day
			this.#state.userAttempts = this.#state.userAttempts.filter(
				(attempt) => attempt.date === today,
			);
		}
	}

	private getDayBasedIndex(date: string): number {
		// Simple deterministic way to select word based on date
		const sum = date.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		return sum;
	}

	private async startUserChallenge(userId: string, triggerId: string) {
		this.ensureDailyWord();

		if (!this.#state.currentWord) {
			log.error('No current word available');
			return;
		}

		const today = this.#state.currentWord.date;
		const existingAttempt = this.#state.userAttempts.find(
			(attempt) => attempt.userId === userId && attempt.date === today,
		);

		if (existingAttempt && existingAttempt.completed) {
			// User has already completed today's challenge
			await this.showCompletedMessage(userId, existingAttempt);
			return;
		}

		// Create or continue user attempt
		let userAttempt = existingAttempt;
		if (!userAttempt) {
			userAttempt = {
				userId,
				date: today,
				questions: [],
				responses: [],
				completed: false,
				questionCount: 0,
			};
			this.#state.userAttempts.push(userAttempt);
		}

		await this.showQuestionDialog(userId, triggerId, userAttempt);
	}

	private async showGuessDialog(userId: string, triggerId: string) {
		const guessDialog = {
			type: 'modal' as const,
			callback_id: `daily20doors_${this.#state.uuid}_guess_dialog`,
			title: {
				type: 'plain_text' as const,
				text: '答えを推測',
			},
			submit: {
				type: 'plain_text' as const,
				text: '推測する',
			},
			close: {
				type: 'plain_text' as const,
				text: 'キャンセル',
			},
			private_metadata: userId,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: '答えを推測してください！\n正解すればゲーム終了です。',
					},
				},
				{
					type: 'input',
					block_id: 'guess_input',
					element: {
						type: 'plain_text_input',
						action_id: 'guess_input',
						placeholder: {
							type: 'plain_text',
							text: '例: バナナ',
						},
						max_length: 50,
					},
					label: {
						type: 'plain_text',
						text: 'あなたの推測',
					},
				},
			],
		};

		await this.#slack.views.open({
			trigger_id: triggerId,
			view: guessDialog,
		});
	}

	private async showQuestionDialog(userId: string, triggerId: string, attempt: UserAttempt) {
		const questionDialog = {
			type: 'modal' as const,
			callback_id: `daily20doors_${this.#state.uuid}_question_dialog`,
			title: {
				type: 'plain_text' as const,
				text: '20の扉ゲーム',
			},
			submit: {
				type: 'plain_text' as const,
				text: '質問する',
			},
			close: {
				type: 'plain_text' as const,
				text: 'キャンセル',
			},
			private_metadata: userId,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `本日のお題を当ててください！\n質問回数: ${attempt.questionCount}/20`,
					},
				},
				...(attempt.questions.length > 0 ? [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '*これまでの質問と回答:*',
						},
					},
					...attempt.questions.slice(-3).map((question, i) => {
						const responseIndex = attempt.questions.length - 3 + i;
						return {
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `Q: ${question}\nA: ${attempt.responses[responseIndex] || '回答待ち'}`,
							},
						};
					}),
				] : []),
				{
					type: 'input',
					block_id: 'question_input',
					element: {
						type: 'plain_text_input',
						action_id: 'question_input',
						placeholder: {
							type: 'plain_text',
							text: '例: それは黄色いですか？',
						},
						max_length: 100,
					},
					label: {
						type: 'plain_text',
						text: 'はい/いいえで答えられる質問をしてください',
					},
				},
				{
					type: 'actions',
					elements: [
						{
							type: 'button',
							text: {
								type: 'plain_text',
								text: '答えを推測する',
							},
							style: 'primary',
							action_id: `daily20doors_${this.#state.uuid}_make_guess`,
						},
					],
				},
			],
		};

		await this.#slack.views.open({
			trigger_id: triggerId,
			view: questionDialog,
		});
	}

	private async handleUserQuestion({userId, question, viewId}: {userId: string, question: string, viewId: string}) {
		log.debug(`User ${userId} asked a question: ${question}`);

		if (!this.#state.currentWord) {
			log.error('No current word available');
			return;
		}

		const today = this.#state.currentWord.date;
		const userAttempt = this.#state.userAttempts.find(
			(attempt) => attempt.userId === userId && attempt.date === today,
		);

		if (!userAttempt || userAttempt.completed) {
			log.error('Invalid user attempt state');
			return;
		}

		if (userAttempt.questionCount >= 20) {
			await this.showGameOver(userId, false);
			return;
		}

		// Add question to attempt
		userAttempt.questions.push(question);
		userAttempt.questionCount++;

		log.debug(`User ${userId} asked question: ${question}`);

		// Get AI response
		const response = await this.getAIResponse(question, this.#state.currentWord);
		userAttempt.responses.push(response);
		log.debug(`AI response for question "${question}": ${response}`);

		// Update the dialog with the response
		await this.updateQuestionDialog(viewId, userAttempt, response);
	}

	private async getAIResponse(question: string, word: DailyWord): Promise<string> {
		try {
			const prompt = `あなたは「20の扉」ゲームの回答者です。秘密の言葉は「${word.word}」です。
質問に対して以下のいずれかで答えてください：
- はい
- いいえ  
- わからない
- たぶんはい
- たぶんいいえ

質問: ${question}

回答は必ず上記の5つの選択肢のいずれかで答えてください。`;

			const completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content: 'あなたは20の扉ゲームの回答者です。質問に対して「はい」「いいえ」「わからない」「たぶんはい」「たぶんいいえ」のいずれかで答えてください。',
					},
					{
						role: 'user',
						content: prompt,
					},
				],
				max_tokens: 50,
				temperature: 0.1,
			});

			const response = completion.choices[0]?.message?.content?.trim() || 'わからない';

			// Ensure response is one of the valid options
			const validResponses = ['はい', 'いいえ', 'わからない', 'たぶんはい', 'たぶんいいえ'];
			if (!validResponses.includes(response)) {
				return 'わからない';
			}

			return response;
		} catch (error) {
			log.error('Error getting AI response:', error);
			return 'わからない';
		}
	}

	private async updateQuestionDialog(viewId: string, attempt: UserAttempt, latestResponse: string) {
		const updatedDialog = {
			type: 'modal' as const,
			callback_id: `daily20doors_${this.#state.uuid}_question_dialog`,
			title: {
				type: 'plain_text' as const,
				text: '20の扉ゲーム',
			},
			submit: {
				type: 'plain_text' as const,
				text: '質問する',
			},
			close: {
				type: 'plain_text' as const,
				text: 'キャンセル',
			},
			private_metadata: attempt.userId,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `本日のお題を当ててください！\n質問回数: ${attempt.questionCount}/20`,
					},
				},
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `*最新の回答:* ${latestResponse}`,
					},
				},
				...(attempt.questions.length > 0 ? [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '*これまでの質問と回答:*',
						},
					},
					...attempt.questions.slice(-3).map((question, i) => {
						const responseIndex = attempt.questions.length - 3 + i;
						return {
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `Q: ${question}\nA: ${attempt.responses[responseIndex] || '回答待ち'}`,
							},
						};
					}),
				] : []),
				{
					type: 'input',
					block_id: 'question_input',
					element: {
						type: 'plain_text_input',
						action_id: 'question_input',
						placeholder: {
							type: 'plain_text',
							text: '例: それは黄色いですか？',
						},
						max_length: 100,
					},
					label: {
						type: 'plain_text',
						text: 'はい/いいえで答えられる質問をしてください',
					},
				},
				{
					type: 'actions',
					elements: [
						{
							type: 'button',
							text: {
								type: 'plain_text',
								text: '答えを推測する',
							},
							style: 'primary',
							action_id: `daily20doors_${this.#state.uuid}_make_guess`,
						},
					],
				},
			],
		};

		await this.#slack.views.update({
			view_id: viewId,
			view: updatedDialog,
		});
	}

	private async handleUserGuess({userId, guess}: {userId: string, guess: string}) {
		if (!this.#state.currentWord) {
			log.error('No current word available');
			return;
		}

		const today = this.#state.currentWord.date;
		const userAttempt = this.#state.userAttempts.find(
			(attempt) => attempt.userId === userId && attempt.date === today,
		);

		if (!userAttempt || userAttempt.completed) {
			log.error('Invalid user attempt state');
			return;
		}

		// Check if guess is correct
		const isCorrect = await this.checkGuess(guess, this.#state.currentWord);

		userAttempt.completed = true;
		userAttempt.correctGuess = guess;

		if (isCorrect) {
			await this.showGameOver(userId, true);
			await this.announceSuccess(userId, userAttempt);
		} else {
			await this.showGameOver(userId, false);
		}
	}

	private async checkGuess(guess: string, word: DailyWord): Promise<boolean> {
		try {
			const prompt = `秘密の言葉は「${word.word}」です。
ユーザーの推測「${guess}」が正解かどうかを判定してください。
完全に一致しなくても、意味が同じまたは非常に近い場合は正解とみなしてください。

「はい」または「いいえ」で答えてください。`;

			const completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content: '与えられた推測が秘密の言葉と一致するかを判定してください。「はい」または「いいえ」で答えてください。',
					},
					{
						role: 'user',
						content: prompt,
					},
				],
				max_tokens: 10,
				temperature: 0,
			});

			const response = completion.choices[0]?.message?.content?.trim() || 'いいえ';
			return response.includes('はい');
		} catch (error) {
			log.error('Error checking guess:', error);
			// Fall back to simple string comparison
			return guess.trim() === word.word;
		}
	}

	private async showGameOver(userId: string, success: boolean) {
		const message = success
			? '🎉 おめでとうございます！正解です！'
			: `😔 残念！正解は「${this.#state.currentWord?.word}」でした。`;

		await this.#slack.chat.postEphemeral({
			channel: this.#SANDBOX_ID,
			user: userId,
			text: message,
		});
	}

	private async showCompletedMessage(userId: string, attempt: UserAttempt) {
		const message = attempt.correctGuess && await this.checkGuess(attempt.correctGuess, this.#state.currentWord!)
			? `本日のチャレンジは既に完了しています！\n質問回数: ${attempt.questionCount}回で正解しました 🎉`
			: `本日のチャレンジは既に完了しています。\n質問回数: ${attempt.questionCount}回でしたが、正解できませんでした。`;

		await this.#slack.chat.postEphemeral({
			channel: this.#SANDBOX_ID,
			user: userId,
			text: message,
		});
	}

	private async announceSuccess(userId: string, attempt: UserAttempt) {
		await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			username: '20の扉ゲーム',
			icon_emoji: ':door:',
			text: `<@${userId}>さんが本日の20の扉ゲームに成功しました！`,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `🎉 <@${userId}>さんが本日の20の扉ゲームに成功しました！\n質問回数: ${attempt.questionCount}回\n正解: ${this.#state.currentWord?.word}`,
					},
				},
			],
		});
	}

	async postDailyChallenge() {
		this.ensureDailyWord();

		if (!this.#state.currentWord) {
			log.error('No current word available for daily challenge');
			return;
		}

		await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			username: '20の扉ゲーム',
			icon_emoji: ':door:',
			text: '本日の20の扉ゲームが始まりました！',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: '🚪 *本日の20の扉ゲーム*\n\n日本語の名詞を当ててください！\nはい/いいえで答えられる質問を最大20回まで聞くことができます。',
					},
				},
				{
					type: 'actions',
					elements: [
						{
							type: 'button',
							text: {
								type: 'plain_text',
								text: 'チャレンジを開始',
								emoji: true,
							},
							style: 'primary',
							action_id: `daily20doors_${this.#state.uuid}_start_game`,
						},
					],
				},
			],
		});
	}
}

