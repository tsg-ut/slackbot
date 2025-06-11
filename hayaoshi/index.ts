import {Mutex} from 'async-mutex';
// @ts-expect-error: not typed
import levenshtein from 'fast-levenshtein';
import {sample, shuffle, flatten, times, constant} from 'lodash';
import type {SlackInterface} from '../lib/slack';
import {normalize, getQuiz, getHardQuiz} from './util';

export {Quiz, Data, normalize, getQuiz, getHardQuiz, getItQuiz, getUserQuiz, getAbc2019Quiz} from './util';

const mutex = new Mutex();

interface QuestionChar {
	char: string,
	hint: number,
}

interface State {
	question: QuestionChar[],
	answer: string,
	previousTick: number,
	previousHint: number,
	hintCount: number,
	misses: {[user: string]: number},
	thread: string,
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

export default ({eventClient, webClient: slack}: SlackInterface) => {
	const state: State = {
		question: [],
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hintCount: 0,
		misses: {},
		thread: null,
	};

	const onTick = () => {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = state.previousHint + (state.hintCount === 13 ? 15 : 5) * 1000;

			if (state.answer !== null && nextHint <= now) {
				state.previousHint = now;

				if (state.hintCount < 13) {
					state.hintCount++;
					await slack.chat.update({
						channel: process.env.CHANNEL_SANDBOX,
						text: `問題です！\nQ. ${getQuestionText(state.question, state.hintCount)}\n\n⚠3回間違えると失格です！\n⚠「?」でメッセージを始めるとコメントできます`,
						ts: state.thread,
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
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `もう、しっかりして！\n\n答えは＊${state.answer}＊だよ:anger:\n${anger}`,
						username: 'hayaoshi',
						icon_emoji: ':question:',
						thread_ts: state.thread,
						reply_broadcast: true,
					});
					state.question = [];
					state.answer = null;
					state.previousHint = 0;
					state.hintCount = 0;
					state.thread = null;
					state.misses = {};
				}
			}

			state.previousTick = now;
		});
	};

	setInterval(onTick, 1000);

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		mutex.runExclusive(async () => {
			if (message.text && (message.text === '早押しクイズ' || message.text === '早押しクイズhard') && state.answer === null) {
				const quiz = await (message.text === '早押しクイズ' ? getQuiz() : getHardQuiz());

				if (quiz === undefined) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: 'エラー😢',
						username: 'hayaoshi',
						icon_emoji: ':question:',
					});
					return;
				}

				state.question = getQuestionChars(quiz.question);
				state.answer = quiz.answer.replace(/\(.+?\)/g, '').replace(/（.+?）/g, '');

				const {ts} = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: `問題です！\nQ. ${getQuestionText(state.question, 1)}\n\n⚠3回間違えると失格です！\n⚠「?」でメッセージを始めるとコメントできます`,
					username: 'hayaoshi',
					icon_emoji: ':question:',
				});

				state.thread = ts as string;
				state.hintCount = 1;
				state.previousHint = Date.now();
				state.misses = {};

				slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '5秒経過でヒントを出すよ♫',
					username: 'hayaoshi',
					icon_emoji: ':question:',
					thread_ts: ts as string,
				});
			}

			if (state.answer !== null && message.text && !message.text.match(/^[?？]/) && message.thread_ts === state.thread && message.username !== 'hayaoshi') {
				if (!{}.hasOwnProperty.call(state.misses, message.user)) {
					state.misses[message.user] = 0;
				}

				if (state.misses[message.user] >= 3) {
					slack.reactions.add({
						name: 'no_entry_sign',
						channel: message.channel,
						timestamp: message.ts,
					});
					return;
				}

				if (isCorrectAnswer(state.answer, message.text)) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `<@${message.user}> 正解🎉\nQ. ＊${getQuestionText(state.question, 13)}＊\n答えは＊${state.answer}＊だよ💪`,
						username: 'hayaoshi',
						icon_emoji: ':question:',
						thread_ts: state.thread,
						reply_broadcast: true,
					});

					state.question = [];
					state.answer = null;
					state.previousHint = 0;
					state.hintCount = 0;
					state.thread = null;
					state.misses = {};
				} else {
					state.misses[message.user]++;
					slack.reactions.add({
						name: 'no_good',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			}
		});
	});
};
