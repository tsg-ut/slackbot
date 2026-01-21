"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const moment_1 = __importDefault(require("moment"));
const axios_1 = __importDefault(require("axios"));
// @ts-expect-error
const japanese_1 = require("japanese");
const sample_1 = __importDefault(require("lodash/sample"));
const fs_1 = __importDefault(require("fs"));
const slackUtils_1 = require("../lib/slackUtils");
const path_1 = __importDefault(require("path"));
const download_1 = require("../lib/download");
function getTimeLink(time) {
    return (0, moment_1.default)(time).utcOffset('+0900').format('HH:mm:ss');
}
async function getHardTheme() {
    const header = await axios_1.default.head('https://www.weblio.jp/WeblioRandomSelectServlet');
    //スペース(+) どうにかする
    return decodeURI(header.request.path.split('/')[2]);
}
async function loadFile(filepath) {
    return await new Promise((resolve, reject) => {
        fs_1.default.readFile(filepath, (err, data) => {
            if (err) {
                return reject(err);
            }
            return resolve(data.toString());
        });
    });
}
exports.default = async ({ eventClient, webClient: slack }) => {
    const states = [];
    const emojipath = path_1.default.join(__dirname, 'data', 'emoji.json');
    await (0, download_1.download)(emojipath, 'https://raw.githubusercontent.com/iamcal/emoji-data/master/emoji.json');
    const default_emoji_list = JSON.parse(await loadFile(emojipath))
        .map((x) => { return x.short_names; }).flat();
    const { team: tsgTeam } = await slack.team.info();
    async function isValidEmoji(name) {
        return default_emoji_list.includes(name) ||
            await (0, slackUtils_1.getEmoji)(name, tsgTeam.id) !== undefined;
    }
    // cat BCCWJ_frequencylist_luw_ver1_0.tsv | grep "名詞" | grep -v "人名" | grep -v "数詞"
    // | awk '{ print $2 "," $3 }' | grep -E -v "^([^,]{1,5}|[^,]{10,100})," | head -n 50000 | tail -n 20000 > common_word_list
    const themepath = path_1.default.join(__dirname, 'data', 'common_word_list');
    await (0, download_1.download)(themepath, 'https://drive.google.com/uc?id=1MO5fDrDHLtrVvNcnfUlddo56w29OWFMc');
    const themes = (await loadFile(themepath)).split('\n');
    function getTheme() {
        const theme = (0, sample_1.default)(themes).split(',');
        return {
            word: theme[1],
            ruby: (0, japanese_1.hiraganize)(theme[0]),
        };
    }
    eventClient.on('message', async (message) => {
        if (!message.text || message.type !== 'message' || message.subtype === 'message_replied') {
            return;
        }
        async function reply(msg) {
            return await slack.chat.postMessage({
                channel: message.channel,
                text: msg,
                username: 'ぽんぺマスター',
                icon_emoji: ':art',
            });
        }
        const answertime = 3 * 60 * 1000;
        const registertime = 5 * 60 * 1000;
        async function chainbids() {
            if (states[0].hints.length > 0) {
                const endtime = Date.now() + answertime;
                const hint = states[0].hints[0];
                const msg = await reply(`${hint.data}\n${hint.user}さんのヒントだよ。${getTimeLink(endtime)}までにこのメッセージへのスレッドとしてひらがなで解答してね。文字数は${states[0].answer.ruby.length}文字だよ。もしこのヒントでわからずに諦める場合は「ギブアップ」と解答してね。`);
                states[0].threadId = msg.ts;
                states[0].timeoutId = setTimeout(chainbids, answertime);
                states[0].hintuser = hint.user;
                states[0].hints.shift();
            }
            else {
                await reply(`だれも正解できなかったよ:cry:。正解は「${states[0].answer.ruby}」だよ。`);
                states.shift();
            }
        }
        if (message.channel.startsWith('D') && message.text === 'ぽんぺお題') {
            if (states.length <= 0) {
                await reply(`まだ開始されていないよ。#sandboxで「ぽんぺ出題」と発言してね。`);
                return;
            }
            if (states[0].answering) {
                await reply(`今は回答中だよ`);
                return;
            }
            await reply(`今の登録中のお題は「${states.slice(-1)[0].answer.ruby}」だよ！`);
            states.slice(-1)[0].registants.push(message.user);
        }
        if (message.channel.startsWith('D') && message.text.startsWith('ぽんぺ登録')) {
            if (states.length <= 0) {
                await reply(`まだ開始されていないよ。#sandboxで「ぽんぺ出題」と発言してね。`);
                return;
            }
            if (states[0].answering) {
                await reply(`今は回答中だよ`);
                return;
            }
            const ponpe = message.text.split('\n').slice(1).map((x) => { return x.replace(/\s/gi, ''); }).join('\n');
            if (!ponpe.match(/^(:[^:\s]+:\s*)*$/)) {
                await reply('emojiのみからなる文字列を登録してください');
                return;
            }
            let emoji_count = 0;
            for (let matchArray, re = /:([^:\s]+):\s*/g; (matchArray = re.exec(ponpe));) {
                const name = matchArray[1];
                if (!await isValidEmoji(name)) {
                    await reply(`:${name}:はemojiとして登録されていないよ:cry:`);
                    return;
                }
                if (!['void', 'white'].includes(name)) {
                    emoji_count += 1;
                }
            }
            const user = await (0, slackUtils_1.getMemberName)(message.user);
            states.slice(-1)[0].hints = states.slice(-1)[0].hints.filter((x) => {
                return x.user !== user;
            });
            states.slice(-1)[0].hints.push({
                data: ponpe,
                cost: emoji_count,
                time: Date.now(),
                user: user,
            });
            await reply(`お題「${states.slice(-1)[0].answer.ruby}」に対してコスト${emoji_count}のぽんぺが登録されたよ:tada:`);
            states.slice(-1)[0].registants.push(message.user);
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: `${user}さんがぽんぺに登録したよ。`,
            });
        }
        if (message.channel === process.env.CHANNEL_SANDBOX) {
            if (states.length > 0 && states[0].threadId !== null && message.thread_ts === states[0].threadId) {
                if (message.text === 'ギブアップ') {
                    await slack.chat.postMessage({
                        channel: message.channel,
                        text: 'ギブアップしたよ:cry:',
                        thread_ts: states[0].threadId,
                    });
                    clearTimeout(states[0].timeoutId);
                    states[0].timeoutId = setTimeout(chainbids, Date.now());
                    return;
                }
                if (states[0].registants.includes(message.user)) {
                    await slack.chat.postMessage({
                        channel: message.channel,
                        text: '答えを知ってるひとが答えちゃだめだよ:imp:',
                        thread_ts: states[0].threadId,
                    });
                }
                else if (message.text === states[0].answer.ruby) {
                    clearTimeout(states[0].timeoutId);
                    await slack.reactions.add({
                        name: 'tada',
                        channel: message.channel,
                        timestamp: message.ts,
                    });
                    await reply(`${await (0, slackUtils_1.getMemberName)(message.user)}さんが${states[0].hintuser}さんのヒントで「${message.text}」を正解したよ！:tada:`);
                    if (states[0].hints.length > 0) {
                        await reply(`以下はほかのひとの登録したヒントだよ。`);
                        for (const hint of states[0].hints) {
                            await reply(`${hint.user}さんのヒントだよ。\n${hint.data}`);
                        }
                    }
                    states.shift();
                }
                else {
                    await slack.reactions.add({
                        name: 'thinking_face',
                        channel: message.channel,
                        timestamp: message.ts,
                    });
                }
            }
            if (message.text === 'ぽんぺ出題') {
                if (states.length > 0 && Date.now() <= states[0].registerend) {
                    await reply(`ぽんぺはすでに始まってるよ。${getTimeLink(states[0].registerend)}までに登録してね。`);
                    return;
                }
                states.unshift({
                    answer: await getTheme(),
                    registerend: Date.now() + registertime,
                    registants: [],
                    hints: [],
                    threadId: null,
                    timeoutId: null,
                    hintuser: null,
                    answering: false,
                });
                await reply(`ぽんぺをはじめるよ:waiwai:。`);
                await reply(`DMで「ぽんぺお題」というとお題を知ることができるよ。`);
                await reply(`DMで「ぽんぺ登録」の次の行にお題を伝えられるようなemoji列を描いて登録してね。voidでないemojiが少ないほど偉いよ。`);
                await reply(`以下は、"寿司職人"というお題に対する登録例だよ`);
                await reply(`\nぽんぺ登録\n:sushi-clockwise-top-left::sushi-go-right::sushi-clockwise-top-right:\n:sushi-go-up::male-cook::sushi-go-down:\n:sushi-clockwise-bottom-left::sushi-go-left::sushi-clockwise-bottom-right:`);
                await reply(`${getTimeLink(states[0].registerend)}以降にここで「ぽんぺ回答」というと、回答フェイズに移行するよ。`);
            }
            if (message.text === 'ぽんぺ回答') {
                if (states.length > 0 && Date.now() <= states[0].registerend) {
                    await reply(`ぽんぺはまだ出題中だよ。${getTimeLink(states[0].registerend)}までに登録してね。`);
                    return;
                }
                else if (states.length > 0 && states[0].answering) {
                    await reply(`既にぽんぺ回答中だよ。`);
                    return;
                }
                await reply(`ぽんぺの回答を始めるよ。`);
                states[0].answering = true;
                states[0].hints.sort((x, y) => {
                    if (x.cost !== y.cost)
                        return x.cost - y.cost;
                    return x.time - y.time;
                });
                await chainbids();
            }
        }
    });
};
