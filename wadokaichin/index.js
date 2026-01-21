"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const async_mutex_1 = require("async-mutex");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const jszip_1 = __importDefault(require("jszip"));
const lodash_1 = require("lodash");
const download_1 = require("../lib/download");
const csv_parse_1 = require("csv-parse");
const atequiz_1 = require("../atequiz");
const common_tags_1 = require("common-tags");
const utils_1 = require("../lib/utils");
/*
Future works
- n文字熟語 / n 段
*/
const mutex = new async_mutex_1.Mutex();
const kanjisLoader = new utils_1.Loader(async () => {
    const text = await fs_1.default.promises.readFile(path_1.default.join(__dirname, 'data', 'JoyoKanjis.txt'));
    return text.toString('utf-8').split('\n');
});
const jukugoLoader = new utils_1.Loader(async () => {
    const kanjis = await kanjisLoader.load();
    const kanjisSet = new Set(kanjis);
    const dictionaryPath = path_1.default.resolve(__dirname, 'data', '2KanjiWords.txt');
    const dictionaryExists = await new Promise((resolve) => {
        fs_1.default.access(dictionaryPath, fs_1.default.constants.F_OK, (error) => {
            resolve(!error);
        });
    });
    if (!dictionaryExists) {
        const corpusPath = path_1.default.resolve(__dirname, 'data', 'corpus.zip');
        await (0, download_1.download)(corpusPath, "https://repository.ninjal.ac.jp/?action=repository_uri&item_id=3231&file_id=22&file_no=1");
        const data = await fs_1.default.promises.readFile(corpusPath);
        const dict = await new Promise((resolve, reject) => {
            jszip_1.default.loadAsync(data).then((zip) => {
                return zip.files["BCCWJ_frequencylist_luw2_ver1_1.tsv"].nodeStream('nodebuffer');
            }).then((text) => {
                const parser = (0, csv_parse_1.parse)({
                    delimiter: '\t',
                    quote: null,
                    skip_records_with_error: true,
                });
                const res = [];
                parser.on('data', (data) => {
                    const word = data[2];
                    if (word.length !== 2)
                        return;
                    if (word.split('').some((c => !kanjisSet.has(c))))
                        return;
                    const type_ = data[3];
                    if (type_.includes("人名"))
                        return;
                    const freq = Number(data[6]);
                    if (freq < 30)
                        return;
                    res.push(word);
                });
                parser.on('error', () => {
                    reject('parse failed');
                });
                parser.on('end', () => {
                    resolve((0, lodash_1.uniq)(res).join('\n'));
                });
                text.pipe(parser);
            });
        });
        await fs_1.default.promises.writeFile(dictionaryPath, dict);
    }
    const js = (await fs_1.default.promises.readFile(dictionaryPath)).toString('utf-8').split('\n');
    const res = [new Map(), new Map()];
    for (const c of kanjis) {
        res.forEach((m) => m.set(c, []));
    }
    for (const j of js) {
        const cs = j.split('');
        if (cs.some((c) => !kanjisSet.has(c))) {
            break;
        }
        res[0].get(cs[0]).push(cs[1]);
        res[1].get(cs[1]).push(cs[0]);
    }
    return res;
});
async function SolveProblem(jukugo, problem) {
    const kanjis = await kanjisLoader.load();
    const dics = problem.problem.map((v, i) => v.map((c) => jukugo[i].get(c)));
    return kanjis.filter((c) => {
        if (dics[0].some(cs => !cs.includes(c)))
            return false;
        if (dics[1].some(cs => !cs.includes(c)))
            return false;
        return true;
    });
}
async function generateProblem(jukugo) {
    const kanjis = await kanjisLoader.load();
    let lcnt = 0;
    let problem = null;
    while (true) {
        const c = (0, lodash_1.sample)(kanjis);
        const j0 = jukugo[0].get(c);
        const j1 = jukugo[1].get(c);
        if (j0.length >= 2 && j1.length >= 2) {
            problem = [
                (0, lodash_1.sampleSize)(j1, 2),
                (0, lodash_1.sampleSize)(j0, 2),
            ];
            break;
        }
        lcnt += 1;
        if (lcnt > 100)
            break;
    }
    // フォントがどうしてもずれる
    const repr = (0, common_tags_1.stripIndent) `
    :_::_::_: ${problem[0][0]}
    :_::_::_::arrow_down:
    :_: ${problem[0][1]} :arrow_right::question::arrow_right: ${problem[1][0]}
    :_::_::_::arrow_down:
    :_::_::_: ${problem[1][1]}
  `;
    const answers = await SolveProblem(jukugo, { problem, repr: "", answers: [], acceptAnswerMap: new Map() });
    const acceptAnswerMap = new Map();
    for (const c of answers) {
        acceptAnswerMap.set(c, c);
        for (const d of problem[0]) {
            acceptAnswerMap.set(d + c, c);
        }
        for (const d of problem[1]) {
            acceptAnswerMap.set(c + d, c);
        }
    }
    return {
        problem,
        repr,
        answers,
        acceptAnswerMap,
    };
}
class WadoQuiz extends atequiz_1.AteQuiz {
    data;
    channel;
    constructor(clients, problem, data, channel, option) {
        super(clients, problem, option);
        this.data = data;
        this.channel = channel;
    }
    waitSecGen() {
        return 180;
    }
    solvedMessageGen(post) {
        const user = post.user;
        const answer = post.text;
        const answerChar = this.data.acceptAnswerMap.get(answer);
        return ({
            channel: this.channel,
            text: (`<@${user}> 『${answerChar}』正解🎉` + (this.data.answers.length === 1 ? "" : `\n他にも『${this.data.answers.filter((c) => c !== answerChar).join('/')}』などが当てはまります。`)),
        });
    }
}
exports.default = (slackClients) => {
    const { eventClient, webClient } = slackClients;
    const channel = process.env.CHANNEL_SANDBOX;
    eventClient.on('message', (message) => {
        if (message.channel !== channel) {
            return;
        }
        if (message.text && (message.text === '和同開珎' ||
            message.text === '和同' ||
            message.text === '開珎' ||
            message.text === 'わどう')) {
            if (mutex.isLocked()) {
                webClient.reactions.add({
                    name: "running",
                    channel: message.channel,
                    timestamp: message.ts,
                });
                return;
            }
            mutex.runExclusive(async () => {
                const data = await generateProblem(await jukugoLoader.load());
                const problem = {
                    problemMessage: {
                        channel,
                        text: `${data.repr}`,
                    },
                    hintMessages: [],
                    immediateMessage: {
                        channel,
                        text: ':question:に入る常用漢字は何でしょう？3分以内に答えてね。'
                    },
                    solvedMessage: null,
                    unsolvedMessage: {
                        channel,
                        text: `時間切れ！\n正解は『${data.answers.join('/')}』でした。`,
                    },
                    answerMessage: null,
                    correctAnswers: [...data.acceptAnswerMap.keys()]
                };
                const quiz = new WadoQuiz(slackClients, problem, data, channel, { username: '和同開珎', icon_emoji: ':coin:' });
                const result = await quiz.start();
                if (result.state === 'solved') {
                    // TODO: add achievenemts
                }
            });
        }
    });
};
