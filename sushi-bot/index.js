"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const node_schedule_1 = __importDefault(require("node-schedule"));
const lodash_1 = require("lodash");
const moment_1 = __importDefault(require("moment"));
const achievements_1 = require("../achievements");
const state_1 = __importDefault(require("../lib/state"));
class Counter {
    name;
    state;
    _state; // FIXME! DELETEME!
    static async init(name) {
        const instance = new Counter(name);
        instance.state = await instance._state;
        return instance;
    }
    constructor(name) {
        this.name = name;
        this._state = state_1.default.init(`sushi-bot-counter-${name}`, { data: {} });
    }
    add(key, cnt = 1) {
        this.state.data[key] = (this.state.data[key] || 0) + cnt;
    }
    max(key, value) {
        if (this.state.data[key]) {
            this.state.data[key] = Math.max(value, this.state.data[key]);
        }
        else {
            this.state.data[key] = value;
        }
    }
    clear() {
        this.state.data = {};
    }
    entries() {
        const keys = Array.from(Object.keys(this.state.data));
        const sortedKeys = (0, lodash_1.sortBy)(keys, (key) => this.state.data[key]).reverse();
        return sortedKeys.map((key) => [key, this.state.data[key]]);
    }
}
function count(haystack, needle) {
    return haystack.split(needle).length - 1;
}
function numToEmoji(num) {
    switch (num) {
        case 0:
            return 'zero';
        case 1:
            return 'one';
        case 2:
            return 'two';
        case 3:
            return 'three';
        case 4:
            return 'four';
        case 5:
            return 'five';
        case 6:
            return 'six';
        case 7:
            return 'seven';
        case 8:
            return 'eight';
        case 9:
            return 'nine';
        case 10:
            return 'keycap_ten';
        default:
            return 'vsonline';
    }
}
async function default_1({ eventClient, webClient: slack }) {
    const [sushiCounter, suspendCounter, dailyAsaCounter, weeklyAsaCounter, dailyexerciseCounter, exerciseCounter, kasuCounter,] = await Promise.all([
        Counter.init('sushi'),
        Counter.init('suspend'),
        Counter.init('dailyAsa'),
        Counter.init('asa'),
        Counter.init('dailyexercise'),
        Counter.init('exercise'),
        Counter.init('kasu'),
    ]);
    eventClient.on('message', async (message) => {
        // when a message is changed (eg. link preview is loaded),
        // this event is fired with message = {
        // 	type: 'message', subtype: 'message_changed', channel: ..,
        // 	message: .., ..
        // }
        const isChanged = message.subtype === 'message_changed';
        const { channel, text, user, ts: timestamp, attachments } = isChanged ? { ...message, ...message.message } : message;
        if (!text) {
            return;
        }
        if (channel.startsWith('D')) {
            const postDM = (text) => (slack.chat.postMessage({
                channel,
                text,
                username: 'sushi-bot',
                // eslint-disable-next-line camelcase
                icon_emoji: ':sushi:',
            }));
            const tokens = text.trim().split(/\s+/);
            if (tokens[0] === '寿司ランキング' && tokens[1] === '確認') {
                let currentRank = 1;
                for (let entry of sushiCounter.entries()) {
                    if (entry[0] === user) {
                        return postDM(`あなたのすし数は${entry[1]}個、現在の順位は${currentRank}位`);
                    }
                    currentRank++;
                }
            }
            if (tokens[0] === '凍結ランキング' && tokens[1] === '確認') {
                let currentRank = 1;
                for (let entry of suspendCounter.entries()) {
                    if (entry[0] === user) {
                        return postDM(`あなたの凍結回数は${entry[1]}回、現在の順位は${currentRank}位`);
                    }
                    currentRank++;
                }
            }
            if (tokens[0] === '起床ランキング' && tokens[1] === '確認') {
                const total = new Map(weeklyAsaCounter.entries());
                dailyAsaCounter.entries().map(([user, score]) => {
                    if (!total.has(user)) {
                        total.set(user, 0);
                    }
                    total.set(user, score + total.get(user));
                });
                const scores = Array.from(total.entries()).sort(([u1, s1], [u2, s2]) => s2 - s1);
                const index = scores.findIndex(([u, _]) => u === user);
                postDM(`あなたの起床点数は${scores[index][1]}点、現在の順位は${index + 1}位`);
            }
            if (tokens[0] === 'エクササイズランキング' && tokens[1] === '確認') {
                const total = new Map(exerciseCounter.entries());
                dailyexerciseCounter.entries().map(([user, score]) => {
                    if (!total.has(user)) {
                        total.set(user, 0);
                    }
                    total.set(user, score + total.get(user));
                });
                const scores = Array.from(total.entries()).sort(([u1, s1], [u2, s2]) => s2 - s1);
                const index = scores.findIndex(([u, _]) => u === user);
                postDM(`あなたのエクササイズ日数は${scores[index][1]}日、現在の順位は${index + 1}位`);
            }
            if (tokens[0] === 'カスランキング' && tokens[1] === '確認') {
                let currentRank = 1;
                for (let entry of kasuCounter.entries()) {
                    if (entry[0] === user) {
                        return postDM(`あなたのカス数は${entry[1]}回、現在の順位は${currentRank}位`);
                    }
                    currentRank++;
                }
            }
        }
        const texts = [text];
        if (attachments) {
            for (const attachment of attachments) {
                if (attachment.pretext)
                    texts.push(attachment.pretext);
                if (attachment.text)
                    texts.push(attachment.text);
                if (attachment.title)
                    texts.push(attachment.title);
            }
        }
        const allText = texts.join('\n');
        {
            const rtext = allText.
                replace(/[鮨鮓]/g, 'すし').
                replace(/(su|zu|[スズず寿壽])/gi, 'す').
                replace(/(sh?i|ci|[しシ司\u{0328}])/giu, 'し');
            const cnt = count(rtext, 'すし');
            if (cnt >= 1) {
                Promise.resolve()
                    .then(() => slack.reactions.add({ name: 'sushi', channel, timestamp }))
                    .then(() => cnt >= 2 &&
                    Promise.resolve()
                        .then(() => slack.reactions.add({ name: 'x', channel, timestamp }))
                        .then(() => slack.reactions.add({ name: numToEmoji(cnt), channel, timestamp })));
                if (channel.startsWith('C')) {
                    sushiCounter.add(user, cnt);
                    switch (true) {
                        case cnt > 10:
                            (0, achievements_1.unlock)(user, 'get-infinite-sushi');
                        // fall through
                        case cnt >= 2:
                            (0, achievements_1.unlock)(user, 'get-multiple-sushi');
                        // fall through
                        case cnt >= 1:
                            (0, achievements_1.unlock)(user, 'get-sushi');
                    }
                    if ((0, moment_1.default)().utcOffset(9).day() === 3) {
                        (0, achievements_1.unlock)(user, 'wednesday-sushi');
                    }
                }
            }
        }
        {
            const rtext = allText.
                replace(/(ca|(ke|け|ケ)(i|ぃ|い|ｨ|ィ|ｲ|イ|e|ぇ|え|ｪ|ェ|ｴ|エ|-|ー))(ki|ke|き|キ)/gi, 'ケーキ');
            if (rtext.includes("ケーキ")) {
                slack.reactions.add({ name: 'cake', channel, timestamp });
            }
        }
        {
            const chians = ["殺", "死", ":korosuzo:"];
            const cnt = chians.reduce((sum, cur) => sum + count(allText, cur), 0);
            if (cnt >= 1) {
                Promise.resolve()
                    .then(() => slack.reactions.add({ name: 'no_good', channel, timestamp }))
                    .then(() => slack.reactions.add({ name: 'shaved_ice', channel, timestamp }))
                    .then(() => cnt >= 2 &&
                    Promise.resolve()
                        .then(() => slack.reactions.add({ name: 'x', channel, timestamp }))
                        .then(() => slack.reactions.add({ name: numToEmoji(cnt), channel, timestamp })));
                if (channel.startsWith('C')) {
                    (0, achievements_1.unlock)(user, 'freezing');
                    suspendCounter.add(user, cnt);
                }
            }
        }
        {
            const rtext = allText.
                replace(/akouryyy/gi, 'akkoury').
                replace(/akouryy/gi, '').
                replace(/kk/gi, 'k').
                replace(/rr/gi, 'r').
                replace(/y/gi, 'yy');
            if (rtext.includes("akouryy")) {
                slack.reactions.add({ name: 'no_good', channel, timestamp });
                slack.reactions.add({ name: 'akouryy', channel, timestamp });
            }
        }
        {
            const stars = ["欲し", "干し", "ほし", "星", "★", "☆"];
            for (const star of stars) {
                if (allText.includes(star)) {
                    slack.reactions.add({ name: 'grapes', channel, timestamp });
                    break;
                }
            }
        }
        {
            const rtext = allText.
                replace(/\s/gi, '').
                replace(/ｻ|サ|:(ahokusa|hokusai)-bottom-left:/gi, 'さ').
                replace(/ｱ|ア|:(ahokusa|hokusai)-top-right:/gi, 'あ').
                replace(/朝/gi, 'あさ').
                replace(/!|！|:exclamation:|:heavy_exclamation_mark:|:grey_exclamation:|:bangbang:/gi, '！').
                replace(/sa/gi, 'さ').
                replace(/a/gi, 'あ');
            if (rtext.match(/^あ+さ！*$/)) {
                const now = (0, moment_1.default)().utcOffset('+0900');
                const decimal_hour = now.hour() + now.minutes() / 60 + now.seconds() / 3600;
                // 6時から9時の間で100点以上をとるサインカーブ
                const score_curve = (t) => Math.cos((t - (6 + 9) / 2) / 24 * 2 * Math.PI);
                const decimal_score = score_curve(decimal_hour) / score_curve(9) * 100;
                const score_names = {
                    '0ten': 0,
                    '5ten': 5,
                    '20': 20,
                    '50': 50,
                    '80': 80,
                    '95': 95,
                    '100': 100,
                    '108': 108,
                };
                let best_score = 0;
                let best_name = "0ten";
                for (const name in score_names) {
                    const score = score_names[name];
                    if (decimal_score >= score && score > best_score) {
                        best_score = score;
                        best_name = name;
                    }
                }
                if (best_score > 0) {
                    (0, achievements_1.unlock)(user, 'asa');
                }
                if (best_score >= 80) {
                    (0, achievements_1.unlock)(user, 'asa-over80');
                }
                slack.reactions.add({ name: best_name, channel, timestamp });
                dailyAsaCounter.max(user, best_score);
            }
        }
        {
            const kasu = 'カス';
            if (channel === process.env.CHANNEL_SANDBOX && allText.includes(kasu)) {
                slack.reactions.add({ name: 'kasukasu_dance', channel, timestamp });
                kasuCounter.add(user);
            }
        }
        {
            if (allText.includes(":exercise-done:") || allText.includes(":kintore_houkoku:")) {
                slack.reactions.add({ name: 'erai', channel, timestamp });
                slack.reactions.add({ name: 'sugoi', channel, timestamp });
                if (channel.startsWith('C')) {
                    (0, achievements_1.unlock)(user, 'first-exercise');
                    dailyexerciseCounter.add(user, 1);
                }
            }
        }
        {
            if (allText.match(/twitter(?!\.com)/i)) {
                slack.reactions.add({ name: 'x-logo', channel, timestamp });
            }
        }
        {
            if (allText.match(/\bx(?!\.com)\b/i)) {
                slack.reactions.add({ name: 'twitter', channel, timestamp });
            }
        }
    });
    node_schedule_1.default.scheduleJob('0 19 * * *', async (date) => {
        dailyAsaCounter.entries().map(([user, score]) => {
            weeklyAsaCounter.add(user, score);
        });
        dailyAsaCounter.clear();
        dailyexerciseCounter.entries().map(([user, score]) => {
            exerciseCounter.add(user, 1);
            (0, achievements_1.increment)(user, 'exercise-cumulative');
        });
        dailyexerciseCounter.clear();
        // on Sundays
        if (date.getDay() === 0) {
            const { members } = await slack.users.list({});
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'sushi-bot',
                text: '今週の凍結ランキング',
                icon_emoji: ':shaved_ice:',
                attachments: suspendCounter.entries().map(([user, count], index) => {
                    const member = members.find(({ id }) => id === user);
                    if (!member) {
                        return null;
                    }
                    const name = member.profile.display_name || member.name;
                    if (index === 0) {
                        (0, achievements_1.unlock)(user, 'freezing-master');
                    }
                    return {
                        author_name: `${index + 1}位: ${name} (${count}回)`,
                        author_icon: member.profile.image_24,
                    };
                }).filter((attachment) => attachment !== null),
            });
            suspendCounter.clear();
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'sushi-bot',
                text: '今週の寿司ランキング',
                icon_emoji: ':sushi:',
                attachments: sushiCounter.entries().map(([user, count], index) => {
                    const member = members.find(({ id }) => id === user);
                    if (!member) {
                        return null;
                    }
                    const name = member.profile.display_name || member.name;
                    return {
                        author_name: `${index + 1}位: ${name} (${count}回)`,
                        author_icon: member.profile.image_24,
                    };
                }).filter((attachment) => attachment !== null),
            });
            sushiCounter.clear();
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'sushi-bot',
                text: '今週の起床ランキング',
                icon_emoji: ':sunrise:',
                attachments: weeklyAsaCounter.entries().map(([user, count], index) => {
                    const member = members.find(({ id }) => id === user);
                    if (!member) {
                        return null;
                    }
                    const name = member.profile.display_name || member.name;
                    if (index === 0 && weeklyAsaCounter.entries().filter(([, c]) => c === count).length === 1) {
                        (0, achievements_1.unlock)(user, 'asa-master');
                    }
                    if (count <= 0) {
                        (0, achievements_1.unlock)(user, 'asa-week-0');
                    }
                    if (count >= 720) {
                        (0, achievements_1.unlock)(user, 'asa-week-720');
                    }
                    if (count >= 7 * 108) {
                        (0, achievements_1.unlock)(user, 'asa-week-perfect');
                    }
                    return {
                        author_name: `${index + 1}位: ${name} (${count}点)`,
                        author_icon: member.profile.image_24,
                    };
                }).filter((attachment) => attachment !== null),
            });
            weeklyAsaCounter.clear();
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'exercise-bot',
                text: '今週のエクササイズランキング',
                icon_emoji: ':muscle:',
                attachments: exerciseCounter.entries().map(([user, count], index) => {
                    const member = members.find(({ id }) => id === user);
                    if (!member) {
                        return null;
                    }
                    const name = member.profile.display_name || member.name;
                    if (count === 7) {
                        (0, achievements_1.unlock)(user, 'everyday-exercise-week');
                    }
                    return {
                        author_name: `${index + 1}位: ${name} (${count}日)`,
                        author_icon: member.profile.image_24,
                    };
                }).filter((attachment) => attachment !== null),
            });
            exerciseCounter.clear();
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'kasu',
                text: '今週のカスランキング',
                icon_emoji: ':kasu:',
                attachments: kasuCounter.entries().map(([user, count], index) => {
                    const member = members.find(({ id }) => id === user);
                    if (!member) {
                        return null;
                    }
                    const name = member.profile.display_name || member.name;
                    return {
                        author_name: `${index + 1}位: ${name} (${count}回)`,
                        author_icon: member.profile.image_24,
                    };
                }).filter((attachment) => attachment !== null),
            });
            kasuCounter.clear();
        }
    });
}
