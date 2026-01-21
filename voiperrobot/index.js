"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const google_tts_api_1 = require("google-tts-api");
const moment_1 = __importDefault(require("moment"));
const querystring_1 = require("querystring");
const assert_1 = __importDefault(require("assert"));
const achievements_1 = require("../achievements");
const mutex_1 = __importDefault(require("./mutex"));
const state = {
    phase: 'waiting',
    ts: null,
    answer: null,
    users: [],
    userIdx: 0,
    answerDeadline: null,
};
const setState = (newState) => {
    Object.assign(state, newState);
};
const battleMutex = new mutex_1.default();
const getPhrasesOf = (text) => text.match(/../g) || [];
const phrases = getPhrasesOf('はっつくパンツかひっつくパンツかくっつくパンツかむかつくパンツか');
const voiper = (num = 8) => Array(num).fill(null).map(() => (0, lodash_1.sample)(phrases)).join('');
const getTtsLink = (text) => {
    const link = (0, google_tts_api_1.getAudioUrl)(text, {
        lang: 'ja-JP',
        slow: false,
    });
    return (`<${link}|${text}>`);
};
const getTimeLink = (time, title = '宣言締切') => {
    const text = (0, moment_1.default)(time).utcOffset('+0900').format('HH:mm:ss');
    const url = `https://www.timeanddate.com/countdown/generic?${(0, querystring_1.stringify)({
        iso: (0, moment_1.default)(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
        p0: 248,
        msg: title,
        font: 'sansserif',
        csz: 1,
    })}`;
    return `<!date^${(0, moment_1.default)(time).valueOf() / 1000 | 0}^{time_secs}^${url}|${text}>`;
};
const validateNumber = (n, dflt) => {
    if (isNaN(n) || !isFinite(n)) {
        return dflt;
    }
    if (n < 0 || n * 2 > 200) {
        return dflt;
    }
    return n || dflt;
};
const sleepUntil = (time) => new Promise((resolve) => setTimeout(resolve, time.valueOf() - Date.now()));
const hitblow = (seq1, seq2) => {
    (0, assert_1.default)(seq1.length === seq2.length);
    const hits = [];
    const nohits = [];
    Array(seq1.length).fill(null).forEach((_, i) => {
        if (seq1[i] === seq2[i]) {
            hits.push(i);
        }
        else {
            nohits.push(i);
        }
    });
    const nohitCount1 = new Map();
    const nohitCount2 = new Map();
    for (const i of nohits) {
        const word1 = seq1[i];
        const word2 = seq2[i];
        nohitCount1.set(word1, nohitCount1.has(word1) ? nohitCount1.get(word1) + 1 : 1);
        nohitCount2.set(word2, nohitCount2.has(word2) ? nohitCount2.get(word2) + 1 : 1);
    }
    const blow = [...new Set([...nohitCount1.keys(), ...nohitCount2.keys()]).values()].map((word) => {
        if (nohitCount1.has(word) && nohitCount2.has(word)) {
            return Math.min(nohitCount1.get(word), nohitCount2.get(word));
        }
        return 0;
    }).reduce((a, b) => a + b, 0);
    return {
        hit: hits.length,
        blow,
    };
};
exports.default = ({ eventClient, webClient: slack }) => {
    eventClient.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            // if (!message.channel.startsWith('D')) {
            // if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
            return;
        }
        if (!message.text) {
            return;
        }
        if (message.username === 'voiperrobot') {
            return;
        }
        const postMessage = (text) => slack.chat.postMessage({
            channel: message.channel,
            text,
            username: 'voiperrobot',
            icon_url: 'https://i.gyazo.com/f0d6407563bf2cb1f4cddbce3f0b74f6.png',
        });
        if (/^@voiperrobot\b|^ボイパーロボット(?:$|\s*(\d+))/.test(message.text)) {
            const m = /^@voiperrobot\b|^ボイパーロボット(?:$|\s*(\d+))/.exec(message.text);
            const voiperLength = validateNumber(parseInt(m[1]), 8);
            await postMessage(getTtsLink(voiper(voiperLength)));
            await (0, achievements_1.unlock)(message.user, 'voiperrobot');
            return;
        }
        if (/^ボイパーロボットバトル(?:$|\s*(\d+))/.test(message.text)) {
            const m = /^ボイパーロボットバトル(?:$|\s*(\d+))/.exec(message.text);
            if (state.phase !== 'waiting' || state.users.includes(message.user)) {
                await postMessage(':ha:');
                return;
            }
            if (state.ts && m[1]) {
                await postMessage(':ha:');
                return;
            }
            const voiperLength = validateNumber(parseInt(m[1]), 4);
            slack.reactions.add({
                name: 'ok_hand',
                channel: message.channel,
                timestamp: message.ts,
            });
            (0, achievements_1.unlock)(message.user, 'voiperrobot-battle');
            if (state.ts) {
                state.users.push(message.user);
                return;
            }
            const registerDeadline = new Date(Date.now() + 60 * 1000);
            // const registerDeadline = new Date(Date.now() + 1 * 1000);
            await battleMutex.exec(async () => {
                setState({
                    ts: message.ts,
                    answer: voiper(voiperLength),
                    users: [message.user],
                    userIdx: 0,
                });
                console.log(state.answer);
                await postMessage(`ボイパーロボットバトルをはじめるよ〜:raised_hand_with_fingers_splayed::sunglasses:\nほかのみんなも${getTimeLink(registerDeadline)}までに「ボイパーロボットバトル」と宣言して参加登録してね。`);
            });
            await sleepUntil(registerDeadline);
            await battleMutex.exec(async () => {
                setState({
                    phase: 'answering',
                    answerDeadline: new Date(Date.now() + 3 * 60 * 1000),
                });
                await postMessage(`${state.answer.length}文字のボイパーを${getTimeLink(state.answerDeadline, '解答締切')}までに解答してね。`);
                await postMessage(`<@${state.users[state.userIdx]}>さんの解答ターンだよ。\n残り${(state.answerDeadline.valueOf() - Date.now()) / 1000 | 0}秒だよ。`);
            });
            await sleepUntil(state.answerDeadline);
            await battleMutex.exec(async () => {
                if (state.phase !== 'answering' || message.ts !== state.ts) {
                    return;
                }
                await postMessage(`だれも正解できなかったよ:cry:\n正解は ${getTtsLink(state.answer)} だよ。`);
                setState({ phase: 'waiting', answer: null, users: [], ts: null });
            });
            return;
        }
        await battleMutex.exec(async () => {
            if (state.phase === 'answering' && message.user === state.users[state.userIdx] && message.text.length === state.answer.length) {
                if (message.text === state.answer) {
                    await postMessage(`正解です!:tada:\n${getTtsLink(state.answer)}`);
                    setState({ phase: 'waiting', answer: null, users: [], ts: null });
                    await (0, achievements_1.unlock)(message.user, 'voiperrobot-win-battle');
                }
                else {
                    const { hit, blow } = hitblow(getPhrasesOf(state.answer), getPhrasesOf(message.text));
                    await postMessage(`「${message.text}」は違うよ:thinking_face:(${hit}H${blow}B)`);
                    if (state.users.length > 1) {
                        setState({
                            userIdx: (state.userIdx + 1) % state.users.length,
                        });
                        await postMessage(`<@${state.users[state.userIdx]}>さんの解答ターンだよ。\n残り${(state.answerDeadline.valueOf() - Date.now()) / 1000 | 0}秒だよ。`);
                    }
                }
            }
        });
    });
};
