"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserQuiz = exports.getAbc2019Quiz = exports.getItQuiz = exports.getHardQuiz = exports.getQuiz = exports.normalize = void 0;
const querystring_1 = require("querystring");
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const googleapis_1 = require("googleapis");
const html_entities_1 = require("html-entities");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
// @ts-expect-error
const japanese_1 = require("japanese");
const lodash_1 = require("lodash");
const scrape_it_1 = __importDefault(require("scrape-it"));
const state_1 = __importDefault(require("../lib/state"));
const utils_1 = require("../lib/utils");
const getSheetRows = (rangeText, sheets) => new Promise((resolve, reject) => {
    sheets.spreadsheets.values.get({
        spreadsheetId: '1357WnNdRvBlDnh3oDtIde7ptDjm2pFFFb-hbytFX4lk',
        range: rangeText,
    }, (error, response) => {
        if (error) {
            reject(error);
        }
        else if (response.data.values) {
            resolve(response.data.values);
        }
        else {
            reject(new Error('values not found'));
        }
    });
});
const loader = new utils_1.Loader(async () => {
    const state = await state_1.default.init('hayaoshi', {
        users: Object.create(null),
        easyCandidates: [],
        itCandidates: [],
        abc2019Candidates: [],
    });
    const auth = new googleapis_1.google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
    const sheetsData = await new Promise((resolve, reject) => {
        sheets.spreadsheets.get({
            spreadsheetId: '1357WnNdRvBlDnh3oDtIde7ptDjm2pFFFb-hbytFX4lk',
        }, (error, response) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(response.data);
            }
        });
    });
    const usersSheet = sheetsData.sheets.find(({ properties }) => properties.title === 'users');
    if (!usersSheet) {
        throw new Error('sheet Users is not found');
    }
    const userRows = await getSheetRows('users!A:C', sheets);
    // 0 is header
    const users = await Promise.all(userRows.slice(1).map(async ([name, slack, discord]) => {
        const quizRows = await getSheetRows(`${name}!A:C`, sheets);
        const quizes = quizRows.map(([id, question, answer]) => ({
            id: parseInt(id), question, answer, author: discord,
        }));
        const count = quizes.length;
        if (!{}.hasOwnProperty.call(state.users, name)) {
            state.users[name] = {
                count,
                candidates: (0, lodash_1.range)(1, count + 1),
            };
        }
        else {
            const oldCount = state.users[name].count;
            if (count > oldCount) {
                state.users[name].candidates.push(...(0, lodash_1.range)(oldCount + 1, count + 1));
                state.users[name].count = count;
            }
        }
        return [
            name,
            { slack, discord, quizes },
        ];
    }));
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
const fullwidth2halfwidth = (string) => (string.replace(/[\uFF01-\uFF5E]/gu, (char) => String.fromCodePoint(char.codePointAt(0) - 0xFF00 + 0x20)));
const normalize = (string) => {
    let newString = string;
    newString = newString.replace(/\(.+?\)/g, '');
    newString = newString.replace(/\[.+?\]/g, '');
    newString = newString.replace(/（.+?）/g, '');
    newString = newString.replace(/【.+?】/g, '');
    newString = newString.replace(/[^\p{Letter}\p{Number}]/gu, '');
    newString = newString.toLowerCase();
    return (0, japanese_1.hiraganize)(fullwidth2halfwidth(newString));
};
exports.normalize = normalize;
const getQuiz = async () => {
    const { state } = await loader.load();
    if (state.easyCandidates.length === 0) {
        state.easyCandidates.push(...(0, lodash_1.range)(1, 1432));
    }
    const id = (0, lodash_1.sample)(state.easyCandidates);
    const page = id > 1200 ? 7 : Math.ceil(id / 200);
    const url = `http://www.chukai.ne.jp/~shintaku/hayaoshi/haya${page.toString().padStart(3, '0')}.htm`;
    const { data } = await axios_1.default.get(url, { responseType: 'arraybuffer' });
    const $ = (0, cheerio_1.load)(iconv_lite_1.default.decode(data, 'sjis'));
    const { quizes } = await scrape_it_1.default.scrapeHTML($, {
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
exports.getQuiz = getQuiz;
const getHardQuizRaw = async () => {
    const id = (0, lodash_1.random)(1, 18191);
    const url = `http://qss.quiz-island.site/abcgo?${(0, querystring_1.encode)({
        ipp: 1,
        page: id,
        target: 0,
        formname: 'lite_search',
    })}`;
    const { data: quiz } = await (0, scrape_it_1.default)(url, {
        id: 'tbody td:nth-child(1)',
        question: {
            selector: 'tbody td:nth-child(3) > a',
            how: 'html',
            convert: (x) => (0, html_entities_1.decode)(x),
        },
        answer: 'tbody td:nth-child(4)',
    });
    // eslint-disable-next-line prefer-destructuring
    quiz.question = quiz.question.split('<br>')[0];
    quiz.answer = quiz.answer.trim();
    return quiz;
};
const getHardQuiz = async () => {
    let quiz = null;
    while (quiz === null || quiz.question.match(/(?:今年|昨年|去年|来年|昨月|今月|来月)/)) {
        quiz = await getHardQuizRaw();
    }
    return quiz;
};
exports.getHardQuiz = getHardQuiz;
const getItQuiz = async () => {
    const { state, itQuizes } = await loader.load();
    if (state.itCandidates.length === 0) {
        state.itCandidates.push(...(0, lodash_1.range)(1, 660));
    }
    const id = (0, lodash_1.sample)(state.itCandidates);
    const quiz = itQuizes.find((q) => q.id === id);
    state.itCandidates.splice(state.itCandidates.findIndex((candidate) => candidate === id), 1);
    return quiz;
};
exports.getItQuiz = getItQuiz;
const getAbc2019Quiz = async () => {
    const { state, abc2019Quizes } = await loader.load();
    if (state.abc2019Candidates.length === 0) {
        state.abc2019Candidates.push(...(0, lodash_1.range)(1, 1341));
    }
    const id = (0, lodash_1.sample)(state.abc2019Candidates);
    const quiz = abc2019Quizes.find((q) => q.id === id);
    state.abc2019Candidates.splice(state.abc2019Candidates.findIndex((candidate) => candidate === id), 1);
    return quiz;
};
exports.getAbc2019Quiz = getAbc2019Quiz;
const getUserQuiz = async () => {
    const { state, users } = await loader.load();
    const usernames = Object.keys(state.users);
    const candidates = [];
    for (const username of usernames) {
        candidates.push(...state.users[username].candidates
            .map((id) => [username, id]));
    }
    if (candidates.length === 0) {
        for (const username of usernames) {
            state.users[username].candidates.push(...(0, lodash_1.range)(1, state.users[username].count + 1));
            candidates.push(...state.users[username].candidates
                .map((id) => [username, id]));
        }
    }
    const [username, id] = (0, lodash_1.sample)(candidates);
    const quiz = users.get(username).quizes.find((q) => q.id === id);
    state.users[username].candidates.splice(state.users[username].candidates.findIndex((candidate) => candidate === id), 1);
    return quiz;
};
exports.getUserQuiz = getUserQuiz;
