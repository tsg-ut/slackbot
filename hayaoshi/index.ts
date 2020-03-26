import {constants, promises as fs} from 'fs';
import path from 'path';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import cheerio from 'cheerio';
// @ts-ignore
import levenshtein from 'fast-levenshtein';
import iconv from 'iconv-lite';
// @ts-ignore
import {hiraganize} from 'japanese';
import {sample, shuffle, flatten, times, constant, range} from 'lodash';
import scrapeIt from 'scrape-it';
import type {SlackInterface} from '../lib/slack';

const mutex = new Mutex();

interface Data {
	quizes: {
		id: number,
		question: string,
		answer: string,
	}[],
}
const statePath = path.resolve(__dirname, 'candidates.json');

const fullwidth2halfwidth = (string: string) => (
	string.replace(/[\uFF01-\uFF5E]/gu, (char) => String.fromCodePoint(char.codePointAt(0) - 0xFF00 + 0x20))
);

const normalize = (string: string) => (
	hiraganize(fullwidth2halfwidth(string.replace(/[^\p{Letter}\p{Number}]/gu, '').toLowerCase()))
);

const getQuiz = async () => {
	const stateExists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
	const candidates = [];
	if (stateExists) {
		const stateData = await fs.readFile(statePath);
		candidates.push(...JSON.parse(stateData.toString()));
	}

	if (candidates.length === 0) {
		candidates.push(...range(1, 1432));
	}

	const id = sample(candidates);
	const page = id > 1200 ? 7 : Math.ceil(id / 200);
	const url = `http://www.chukai.ne.jp/~shintaku/hayaoshi/haya${page.toString().padStart(3, '0')}.htm`;
	const {data} = await axios.get(url, {responseType: 'arraybuffer'});
	const $ = cheerio.load(iconv.decode(data, 'sjis'));
	const {quizes} = await scrapeIt.scrapeHTML<Data>($, {
		test: 'tbody',
		quizes: {
			listItem: 'tbody > tr',
			data: {
				id: {
					selector: 'td:nth-child(1)',
					convert: (n) => parseInt(n),
				},
				question: 'td:nth-child(2)',
				answer: 'td:nth-child(3)',
			},
		},
	});

	const quiz = quizes.find((q) => q.id === id);

	await fs.writeFile(statePath, JSON.stringify(candidates.filter((candidate) => candidate !== id)));

	return quiz;
};

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
	const hintCounts = [0, 0.1, 0.2, 0.35, 0.55, 0.8, 0.9, 1].map((n) => Math.floor(letters * n));
	const hints = shuffle(flatten(times(7, (n) => (
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

export default ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
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
			const nextHint = state.previousHint + (state.hintCount === 7 ? 30 : 10) * 1000;

			if (state.answer !== null && nextHint <= now) {
				state.previousHint = now;

				if (state.hintCount < 7) {
					state.hintCount++;
					await slack.chat.update({
						channel: process.env.CHANNEL_SANDBOX,
						text: `問題です！\nQ. ${getQuestionText(state.question, state.hintCount)}\n\n⚠3回間違えると失格です！`,
						username: 'hayaoshi',
						icon_emoji: ':question:',
						ts: state.thread,
					});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
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

	rtm.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		mutex.runExclusive(async () => {
			if (message.text && message.text === '早押しクイズ' && state.answer === null) {
				const quiz = await getQuiz();

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
				state.answer = quiz.answer;

				const {ts} = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: `問題です！\nQ. ${getQuestionText(state.question, 1)}\n\n⚠3回間違えると失格です！`,
					username: 'hayaoshi',
					icon_emoji: ':question:',
				});

				state.thread = ts as string;
				state.hintCount = 1;
				state.previousHint = Date.now();
				state.misses = {};

				slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '10秒経過でヒントを出すよ♫',
					username: 'hayaoshi',
					icon_emoji: ':question:',
					thread_ts: ts as string,
				});
			}

			if (state.answer !== null && message.text && message.thread_ts === state.thread && message.username !== 'hayaoshi') {
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

				const answer = normalize(state.answer);
				const userAnswer = normalize(message.text);

				const distance = levenshtein.get(answer, userAnswer);

				if (distance <= answer.length / 4) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `<@${message.user}> 正解🎉\nQ. ＊${getQuestionText(state.question, 7)}＊\n答えは＊${state.answer}＊だよ💪`,
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
