import {constants, promises as fs} from 'fs';
import path from 'path';
import {encode} from 'querystring';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import cheerio from 'cheerio';
// @ts-ignore
import levenshtein from 'fast-levenshtein';
import {AllHtmlEntities} from 'html-entities';
import iconv from 'iconv-lite';
// @ts-ignore
import {hiraganize} from 'japanese';
import {random, sample, shuffle, flatten, times, constant, range} from 'lodash';
import scrapeIt from 'scrape-it';
import type {SlackInterface} from '../lib/slack';
import {google} from 'googleapis';

const mutex = new Mutex();

export interface Quiz {
	id: number,
	question: string,
	answer: string,
	author?: string,
}

interface Data {
	quizes: Quiz[],
}

const statePath = path.resolve(__dirname, 'candidates.json');
const itStatePath = path.resolve(__dirname, 'candidates-it.json');
const hakatashiItStatePath = path.resolve(__dirname, 'candidates-hakatashi-it.json');

const fullwidth2halfwidth = (string: string) => (
	string.replace(/[\uFF01-\uFF5E]/gu, (char) => String.fromCodePoint(char.codePointAt(0) - 0xFF00 + 0x20))
);

export const normalize = (string: string) => { 
	let newString = string;
	newString = newString.replace(/\(.+?\)/g, '');
	newString = newString.replace(/\[.+?\]/g, '');
	newString = newString.replace(/（.+?）/g, '');
	newString = newString.replace(/【.+?】/g, '');
	newString = newString.replace(/[^\p{Letter}\p{Number}]/gu, '');
	newString = newString.toLowerCase();
	return hiraganize(fullwidth2halfwidth(newString))
};

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

export const getHardQuiz = async () => {
	const id = random(1, 18191);
	const url = `http://qss.quiz-island.site/abcgo?${encode({
		ipp: 1,
		page: id,
		target: 0,
		formname: 'lite_search',
	})}`;

	const entities = new AllHtmlEntities();
	const {data: quiz} = await scrapeIt<Quiz>(url, {
		id: 'tbody td:nth-child(1)',
		question: {
			selector: 'tbody td:nth-child(3) > a',
			how: 'html',
			convert: (x) => entities.decode(x),
		},
		answer: 'tbody td:nth-child(4)',
	});

	// eslint-disable-next-line prefer-destructuring
	quiz.question = quiz.question.split('<br>')[0];
	quiz.answer = quiz.answer.trim();

	return quiz;
};

export const getItQuiz = async () => {
	const stateExists = await fs.access(itStatePath, constants.F_OK).then(() => true).catch(() => false);
	const candidates = [];
	if (stateExists) {
		const stateData = await fs.readFile(itStatePath);
		candidates.push(...JSON.parse(stateData.toString()));
	}

	if (candidates.length === 0) {
		candidates.push(...range(1, 660));
	}

	const id = sample(candidates);

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const values: [string, string, string][] = await new Promise((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: '1357WnNdRvBlDnh3oDtIde7ptDjm2pFFFb-hbytFX4lk',
			range: 'A:C',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else if (response.data.values) {
				resolve(response.data.values as [string, string, string][]);
			} else {
				reject(new Error('values not found'));
			}
		});
	});

	const quizes: Quiz[] = values.map(([id, question, answer]) => ({
		id: parseInt(id), question, answer,
	}));

	const quiz = quizes.find((q) => q.id === id);

	await fs.writeFile(itStatePath, JSON.stringify(candidates.filter((candidate) => candidate !== id)));

	return quiz;
};

export const getHakatashiItQuiz = async () => {
	const stateExists = await fs.access(hakatashiItStatePath, constants.F_OK).then(() => true).catch(() => false);
	const candidates = [];
	if (stateExists) {
		const stateData = await fs.readFile(hakatashiItStatePath);
		candidates.push(...JSON.parse(stateData.toString()));
	}

	if (candidates.length === 0) {
		candidates.push(...range(1, 450));
	}

	const id = sample(candidates);

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const values: [string, string, string][] = await new Promise((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: '1357WnNdRvBlDnh3oDtIde7ptDjm2pFFFb-hbytFX4lk',
			range: 'Original!A:C',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else if (response.data.values) {
				resolve(response.data.values as [string, string, string][]);
			} else {
				reject(new Error('values not found'));
			}
		});
	});

	const quizes: Quiz[] = values.map(([id, question, answer]) => ({
		id: parseInt(id), question, answer, author: '320061621395259392',
	}));

	const quiz = quizes.find((q) => q.id === id);

	await fs.writeFile(hakatashiItStatePath, JSON.stringify(candidates.filter((candidate) => candidate !== id)));

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
			const nextHint = state.previousHint + (state.hintCount === 13 ? 15 : 5) * 1000;

			if (state.answer !== null && nextHint <= now) {
				state.previousHint = now;

				if (state.hintCount < 13) {
					state.hintCount++;
					await slack.chat.update({
						channel: process.env.CHANNEL_SANDBOX,
						text: `問題です！\nQ. ${getQuestionText(state.question, state.hintCount)}\n\n⚠3回間違えると失格です！\n⚠「?」でメッセージを始めるとコメントできます`,
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

	rtm.on('message', (message) => {
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
