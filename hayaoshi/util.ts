import {encode} from 'querystring';
import axios from 'axios';
import cheerio from 'cheerio';
import {google, sheets_v4} from 'googleapis';
import {decode as decodeHtmlEntities} from 'html-entities';
import iconv from 'iconv-lite';
// @ts-expect-error
import {hiraganize} from 'japanese';
import {random, sample, range} from 'lodash';
import scrapeIt from 'scrape-it';
import State from '../lib/state';
import {Loader} from '../lib/utils';

export interface Quiz {
	id: number,
	question: string,
	answer: string,
	note?: string,
	author?: string,
}

export interface Data {
	quizes: Quiz[],
}

interface QuizUser {
	slack: string,
	discord: string,
	quizes: Quiz[],
}

interface LoaderData {
	itQuizes: Quiz[],
	abc2019Quizes: Quiz[],
	users: Map<string, QuizUser>,
	state: StateObj,
}

interface StateObj {
	users: {
		[name: string]: {
			count: number,
			candidates: number[],
		},
	},
	easyCandidates: number[],
	itCandidates: number[],
	abc2019Candidates: number[],
}

const getSheetRows = (rangeText: string, sheets: sheets_v4.Sheets) => new Promise<string[][]>((resolve, reject) => {
	sheets.spreadsheets.values.get({
		spreadsheetId: '1357WnNdRvBlDnh3oDtIde7ptDjm2pFFFb-hbytFX4lk',
		range: rangeText,
	}, (error, response) => {
		if (error) {
			reject(error);
		} else if (response.data.values) {
			resolve(response.data.values as string[][]);
		} else {
			reject(new Error('values not found'));
		}
	});
});

const loader = new Loader<LoaderData>(async () => {
	const state = await State.init<StateObj>('hayaoshi', {
		users: Object.create(null),
		easyCandidates: [],
		itCandidates: [],
		abc2019Candidates: [],
	});

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const sheetsData = await new Promise<sheets_v4.Schema$Spreadsheet>((resolve, reject) => {
		sheets.spreadsheets.get({
			spreadsheetId: '1357WnNdRvBlDnh3oDtIde7ptDjm2pFFFb-hbytFX4lk',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else {
				resolve(response.data);
			}
		});
	});

	const usersSheet = sheetsData.sheets.find(({properties}) => properties.title === 'users');
	if (!usersSheet) {
		throw new Error('sheet Users is not found');
	}

	const userRows = await getSheetRows('users!A:C', sheets);

	// 0 is header
	const users: [string, QuizUser][] = await Promise.all(
		userRows.slice(1).map(async ([name, slack, discord]) => {
			const quizRows = await getSheetRows(`${name}!A:C`, sheets);
			const quizes = quizRows.map(([id, question, answer]) => ({
				id: parseInt(id), question, answer, author: discord,
			}));

			const count = quizes.length;
			if (!{}.hasOwnProperty.call(state.users, name)) {
				state.users[name] = {
					count,
					candidates: range(1, count + 1),
				};
			} else {
				const oldCount = state.users[name].count;
				if (count > oldCount) {
					state.users[name].candidates.push(...range(oldCount + 1, count + 1));
					state.users[name].count = count;
				}
			}

			return [
				name,
				{slack, discord, quizes},
			] as [string, QuizUser];
		}),
	);

	const usersMap = new Map(users);

	const [itQuizes, abc2019Quizes] = await Promise.all([
		(async () => {
			const quizRows = await getSheetRows('it_open!A:C', sheets);
			return quizRows.map(([id, question, answer]) => ({
				id: parseInt(id), question, answer,
			}));
		})(),
		(async () => {
			const quizRows = await getSheetRows('abc2019!A:D', sheets);
			return quizRows.map(([, question, answer, note], i) => ({
				id: i + 1, question, answer, note: note || '',
			}));
		})(),
	]);

	return {
		state,
		itQuizes,
		abc2019Quizes,
		users: usersMap,
	};
});

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
	return hiraganize(fullwidth2halfwidth(newString));
};

export const getQuiz = async () => {
	const {state} = await loader.load();

	if (state.easyCandidates.length === 0) {
		state.easyCandidates.push(...range(1, 1432));
	}

	const id = sample(state.easyCandidates);
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

	state.easyCandidates.splice(state.easyCandidates.findIndex((candidate) => candidate === id), 1);

	return quiz;
};

const getHardQuizRaw = async () => {
	const id = random(1, 18191);
	const url = `http://qss.quiz-island.site/abcgo?${encode({
		ipp: 1,
		page: id,
		target: 0,
		formname: 'lite_search',
	})}`;

	const {data: quiz} = await scrapeIt<Quiz>(url, {
		id: 'tbody td:nth-child(1)',
		question: {
			selector: 'tbody td:nth-child(3) > a',
			how: 'html',
			convert: (x) => decodeHtmlEntities(x),
		},
		answer: 'tbody td:nth-child(4)',
	});

	// eslint-disable-next-line prefer-destructuring
	quiz.question = quiz.question.split('<br>')[0];
	quiz.answer = quiz.answer.trim();

	return quiz;
};

export const getHardQuiz = async () => {
	let quiz: Quiz = null;
	while (quiz === null || quiz.question.match(/(?:今年|昨年|去年|来年|昨月|今月|来月)/)) {
		quiz = await getHardQuizRaw();
	}
	return quiz;
};

export const getItQuiz = async () => {
	const {state, itQuizes} = await loader.load();

	if (state.itCandidates.length === 0) {
		state.itCandidates.push(...range(1, 660));
	}

	const id = sample(state.itCandidates);
	const quiz = itQuizes.find((q) => q.id === id);
	state.itCandidates.splice(state.itCandidates.findIndex((candidate) => candidate === id), 1);

	return quiz;
};

export const getAbc2019Quiz = async () => {
	const {state, abc2019Quizes} = await loader.load();

	if (state.abc2019Candidates.length === 0) {
		state.abc2019Candidates.push(...range(1, 1341));
	}

	const id = sample(state.abc2019Candidates);
	const quiz = abc2019Quizes.find((q) => q.id === id);
	state.abc2019Candidates.splice(state.abc2019Candidates.findIndex((candidate) => candidate === id), 1);

	return quiz;
};

export const getUserQuiz = async () => {
	const {state, users} = await loader.load();

	const usernames = Object.keys(state.users);

	const candidates: [string, number][] = [];
	for (const username of usernames) {
		candidates.push(
			...state.users[username].candidates
				.map((id) => [username, id] as [string, number]),
		);
	}

	if (candidates.length === 0) {
		for (const username of usernames) {
			state.users[username].candidates.push(...range(1, state.users[username].count + 1));
			candidates.push(
				...state.users[username].candidates
					.map((id) => [username, id] as [string, number]),
			);
		}
	}

	const [username, id] = sample(candidates);
	const quiz = users.get(username).quizes.find((q) => q.id === id);
	state.users[username].candidates.splice(state.users[username].candidates.findIndex((candidate) => candidate === id), 1);

	return quiz;
};
