import type {GenericMessageEvent, MessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
// @ts-expect-error: not typed
import levenshtein from 'fast-levenshtein';
import {sample, shuffle, flatten, times, constant} from 'lodash-es';
import {ChannelLimitedBot} from '../lib/channelLimitedBot.js';
import type {SlackInterface} from '../lib/slack.js';
import {extractMessage, HumanMessageEvent, isHumanMessage} from '../lib/slackUtils.js';
import {Deferred} from '../lib/utils.js';
import {normalize, getQuiz, getHardQuiz} from './util.js';

export {Quiz, Data, normalize, getQuiz, getHardQuiz, getItQuiz, getUserQuiz, getAbc2019Quiz} from './util.js';

const mutex = new Mutex();

interface QuestionChar {
	char: string,
	hint: number,
}

interface State {
	question: QuestionChar[],
	answer: string | null,
	previousTick: number,
	previousHint: number,
	hintCount: number,
	misses: {[user: string]: number},
	thread: string | null,
	channel: string | null,
}

const getQuestionChars = (question: string): QuestionChar[] => {
	const chars = Array.from(question);
	const letters = chars.filter((char) => char.match(/^[\p{Letter}\p{Number}]+$/u)).length;
	const hintCounts = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.35, 0.45, 0.55, 0.7, 0.8, 0.9, 0.95, 1].map((n) => Math.floor(letters * n));
	const hints = shuffle(flatten(times(13, (n) => (
		times(hintCounts[n + 1] - hintCounts[n], constant(n + 1))
	))));

	let pointer = 0;
	return chars.map((char) => {
		if (char.match(/^[\p{Letter}\p{Number}]+$/u)) {
			const hint = hints[pointer];
			pointer++;
			return {char, hint};
		}
		return {char, hint: 1};
	});
};

const getQuestionText = (questionChars: QuestionChar[], hint: number) => (
	questionChars.map((char) => char.hint <= hint ? char.char : '○').join('')
);

export const isCorrectAnswer = (answerText: string, userAnswerText: string) => {
	const answer = normalize(answerText);
	const userAnswer = normalize(userAnswerText);

	const distance = levenshtein.get(answer, userAnswer);

	return distance <= answer.length / 3;
};

class HayaoshiBot extends ChannelLimitedBot {
	private state: State;

	protected override readonly username = 'hayaoshi';

	protected override readonly iconEmoji = ':question:';

	protected override readonly wakeWordRegex = /^早押しクイズ(?:hard)?$/;

	constructor(slackClients: SlackInterface) {
		super(slackClients);

		this.state = {
			question: [],
			answer: null,
			previousTick: 0,
			previousHint: 0,
			hintCount: 0,
			misses: {},
			thread: null,
			channel: null,
		};

		setInterval(() => this.onTick(), 1000);
	}

	async onMessageEvent(event: MessageEvent) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);

		// Answer checking in thread
		if (
			this.allowedChannels.includes(message.channel) &&
			message.thread_ts === this.state.thread &&
			isHumanMessage(message) &&
			this.state.answer !== null &&
			message.text &&
			!message.text.match(/^[?？]/)
		) {
			await this.handleAnswer(message);
		}
	}

	onTick() {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = this.state.previousHint + (this.state.hintCount === 13 ? 15 : 5) * 1000;

			if (this.state.answer !== null && nextHint <= now) {
				this.state.previousHint = now;

				if (this.state.hintCount < 13) {
					this.state.hintCount++;
					await this.slack.chat.update({
						channel: this.state.channel,
						text: `問題です！\nQ. ${getQuestionText(this.state.question, this.state.hintCount)}\n\n⚠3回間違えると失格です！\n⚠「?」でメッセージを始めるとコメントできます`,
						ts: this.state.thread,
					});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
						'こんなの当たり前だよね？',
					]);
					await this.postMessage({
						channel: this.state.channel,
						text: `もう、しっかりして！\n\n答えは＊${this.state.answer}＊だよ:anger:\n${anger}`,
						thread_ts: this.state.thread,
						reply_broadcast: true,
					});

					await this.deleteProgressMessage(this.state.thread);

					this.state.question = [];
					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hintCount = 0;
					this.state.thread = null;
					this.state.channel = null;
					this.state.misses = {};
				}
			}

			this.state.previousTick = now;
		});
	}

	protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		if (this.state.answer !== null) {
			return Promise.resolve(null);
		}

		const quizMessageDeferred = new Deferred<string | null>();

		mutex.runExclusive(async () => {
			try {
				const isHard = message.text === '早押しクイズhard';
				const quiz = await (isHard ? getHardQuiz() : getQuiz());

				if (quiz === undefined) {
					await this.postMessage({
						channel,
						text: 'エラー😢',
					});
					quizMessageDeferred.resolve(null);
					return;
				}

				this.state.question = getQuestionChars(quiz.question);
				this.state.answer = quiz.answer.replace(/\(.+?\)/g, '').replace(/（.+?）/g, '');

				const {ts} = await this.postMessage({
					channel,
					text: `問題です！\nQ. ${getQuestionText(this.state.question, 1)}\n\n⚠3回間違えると失格です！\n⚠「?」でメッセージを始めるとコメントできます`,
				});

				this.state.thread = ts;
				this.state.channel = channel;
				this.state.hintCount = 1;
				this.state.previousHint = Date.now();
				this.state.misses = {};

				await this.postMessage({
					channel,
					text: '5秒経過でヒントを出すよ♫',
					thread_ts: ts,
				});

				quizMessageDeferred.resolve(ts);
			} catch (error) {
				this.log.error('Failed to start hayaoshi quiz', error);
				const errorText =
					error instanceof Error && error.stack !== undefined
						? error.stack : String(error);
				await this.postMessage({
					channel,
					text: `エラー😢\n\`${errorText}\``,
				});
				quizMessageDeferred.resolve(null);
			}
		});

		return quizMessageDeferred.promise;
	}

	async handleAnswer(message: HumanMessageEvent) {
		await mutex.runExclusive(async () => {
			if (!Object.prototype.hasOwnProperty.call(this.state.misses, message.user)) {
				this.state.misses[message.user] = 0;
			}

			if (this.state.misses[message.user] >= 3) {
				await this.slack.reactions.add({
					name: 'no_entry_sign',
					channel: message.channel,
					timestamp: message.ts,
				});
				return;
			}

			if (isCorrectAnswer(this.state.answer, message.text)) {
				await this.postMessage({
					channel: this.state.channel,
					text: `<@${message.user}> 正解🎉\nQ. ＊${getQuestionText(this.state.question, 13)}＊\n答えは＊${this.state.answer}＊だよ💪`,
					thread_ts: this.state.thread,
					reply_broadcast: true,
				});

				await this.deleteProgressMessage(this.state.thread);

				this.state.question = [];
				this.state.answer = null;
				this.state.previousHint = 0;
				this.state.hintCount = 0;
				this.state.thread = null;
				this.state.channel = null;
				this.state.misses = {};
			} else {
				this.state.misses[message.user]++;
				await this.slack.reactions.add({
					name: 'no_good',
					channel: message.channel,
					timestamp: message.ts,
				});
			}
		});
	}
}

export default (slackClients: SlackInterface) => new HayaoshiBot(slackClients);
