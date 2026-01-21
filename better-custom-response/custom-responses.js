"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
// @ts-expect-error
const japanese_1 = require("japanese");
const lodash_1 = require("lodash");
const kuromojin_1 = require("kuromojin");
const omikuji_json_1 = __importDefault(require("./omikuji.json"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const customResponses = [
    {
        input: [/^[あほくさ]{4}$/],
        outputFunction: (input) => {
            const ahokusaMap = new Map([
                ['あ', 'ahokusa-top-right'],
                ['ほ', 'ahokusa-bottom-right'],
                ['く', 'ahokusa-top-left'],
                ['さ', 'ahokusa-bottom-left'],
            ]);
            const [a, ho, ku, sa] = Array.from(input[0]).map((c, i, a) => ahokusaMap.get(c));
            const outputStr = `:${ku}::ahokusa-top-center::${a}:\n:${sa}::ahokusa-bottom-center::${ho}:`;
            return [outputStr];
        },
        username: 'あほくさresponse',
        icon_emoji: ':atama:',
    },
    {
        input: [/^2d6$/, /^ダイス$/],
        outputArray: [":kurgm1::kurgm1:", ":kurgm1::kurgm2:", ":kurgm1::kurgm3:", ":kurgm1::kurgm4:", ":kurgm1::kurgm5:", ":kurgm1::kurgm6:", ":kurgm2::kurgm1:", ":kurgm2::kurgm2:", ":kurgm2::kurgm3:", ":kurgm2::kurgm4:", ":kurgm2::kurgm5:", ":kurgm2::kurgm6:", ":kurgm3::kurgm1:", ":kurgm3::kurgm2:", ":kurgm3::kurgm3:", ":kurgm3::kurgm4:", ":kurgm3::kurgm5:", ":kurgm3::kurgm6:", ":kurgm4::kurgm1:", ":kurgm4::kurgm2:", ":kurgm4::kurgm3:", ":kurgm4::kurgm4:", ":kurgm4::kurgm5:", ":kurgm4::kurgm6:", ":kurgm5::kurgm1:", ":kurgm5::kurgm2:", ":kurgm5::kurgm3:", ":kurgm5::kurgm4:", ":kurgm5::kurgm5:", ":kurgm5::kurgm6:", ":kurgm6::kurgm1:", ":kurgm6::kurgm2:", ":kurgm6::kurgm3:", ":kurgm6::kurgm4:", ":kurgm6::kurgm5:", ":kurgm6::kurgm6:"],
    },
    {
        input: [/^(おじぎねこ)?ファミリー$/],
        outputArray: [":ojigineko:", ":party-ojigineko-line:", ":ojigineko-superfast:", ":nameraka-ojigineko-extreme-fast:", ":ojigineko-fast:", ":ojigineko-extremefast:", ":ojigineko-pi:", ":iceojigineko:", ":ojigineko-hd:", ":ojigineko-drug:", ":dot-ojigineko:", ":ojigineko-waking:", ":party-ojigineko:", ":ojigineko-mirror:", ":ojigineko-sleeping:", ":space-ojigineko:", ":ojigiharassment:", ":ojigineko-mirror-pi:", ":magao-ojigineko:", ":nameraka-ojigineko:", ":party-ojigineko-fast:", ":quantum-ojigineko:", ":fukigen-ojigineko:", ":ojigineko-with-satos:", ":haritsuita-ojigineko:", ":harassment-ojigineko:", ":ojigineko-gokyu-kaiken:", ":ojigineko-muscle-exercise:", ":tosshutsu-symmetry-ojigineko:", ":ojigineko-upside-down:", ":ojikineko:", ":ojigineko-tired:", ":ojigineko-twin-sleeping:", ":nameraka-party-ojigineko-extremefast:", ":nameraka-ojigineko-ultraextreme-fast:", ":ojigiodoshi:", ":tashigineko:", ":dot-ojigineko:", ":tosshutsu-symmetry-rotating:", ":tosshutsu-symmetry-rotating-fast:", ":tosshutsu-symmetry-rotating-extremefast:", ":ojigineko-distorted:"],
        shuffle: true,
        icon_emoji: ':ojigineko:',
    },
    {
        input: [/((ね|ネ|ﾈ|ne)(こ|コ|ｺ|ko))|猫|cat|にゃ|nya|meow/i],
        outputArray: ['nya-n', 'neko'],
        reaction: true,
    },
    {
        input: [/@tsgcat(?![A-Za-z])/],
        outputArray: ['ねこ〜', 'すぴー'],
        icon_emoji: ':cat2:',
        username: 'tsgcat',
    },
    {
        input: [/^(.+)っちへ$/],
        outputFunction: input => [(0, common_tags_1.stripIndent) `
            ${input[1]}っちへ

            ういっすー!
            朝から、完全にぽんぽんぺいんで、つらみが深いので、1日おふとんでスヤァしておきます。
            明日は行けたら行くマンです!`],
        icon_emoji: ':shakaijin-ichinensei:',
        username: '社会人一年生',
    },
    {
        input: [/^(.+)ぴへ$/],
        outputFunction: input => [(0, common_tags_1.stripIndent) `
            ${input[1]}ぴへ

            なんかバイブス上げてくの
            最近ムリムリのムリで
            ぴえんこえてぱおん🐘💔

            もうまじ退職しか勝たんから
            明日からはおうちカフェで
            働くことにしました🐰

            いままで397❤❤
            また会おーね👋😃`],
        icon_emoji: ':shakaijin-ichinensei:',
        username: '社会人一年生',
    },
    {
        input: [/(sa|さ|サ)(l|ー)?(mo|も|モ)(n|ん|ン)/i],
        outputArray: ['sushi-salmon'],
        reaction: true,
    },
    ...['まぐろ', 'たまご', 'えび', 'とろ', 'いくら', 'たい', 'うに', 'いか'].map((neta) => {
        const regexStr = Array.from(neta)
            .map((char) => `(${char}|${(0, japanese_1.romanize)(char)}|${(0, japanese_1.katakanize)(char)})`)
            .join('');
        return {
            input: [new RegExp(regexStr, 'i')],
            outputArray: [`sushi-${(0, japanese_1.romanize)(neta)}`],
            reaction: true,
        };
    }),
    {
        input: [/^:question:$/],
        outputFunction: (input) => {
            let thres = 0.83;
            let randv = Math.random();
            if (randv < thres) {
                return [':exclamation:'];
            }
            else {
                return [':exclamation_w:'];
            }
        },
        icon_emoji: ':kadokawa:',
        username: 'KADOKAWA',
    },
    {
        input: [/デニム/],
        outputFunction: (input) => {
            const lane = (0, lodash_1.shuffle)([1, 2, 3, 4, 5, 6, 7]);
            const white = "|　　|" + lane.map((i) => (i % 2 === 1) ? "＿|" : "　|").join("");
            const black = "|　　|" + lane.map((i) => (i % 2 === 0) ? "＿|" : "　|").join("");
            const resultString = `${black}\n${white}\n`.repeat(4);
            return [resultString];
        },
        icon_emoji: ":iidx-muri-1p:",
        username: "ガチ割れ行くぜ！",
        achievements: [
            {
                trigger: [/\|　　\|　\|　\|　\|＿\|＿\|＿\|＿\|/],
                name: "bcr-denim-fullsplit"
            },
            {
                trigger: [/\|　　\|＿\|＿\|＿\|＿\|　\|　\|　\|/],
                name: "bcr-denim-reversplit"
            },
        ],
    },
    {
        input: [/^実績一覧 <@(U[A-Z0-9]+)>$/],
        outputFunction: (input) => {
            return [`https://achievements.tsg.ne.jp/users/${input[1]}`];
        },
        icon_emoji: ":achievement:",
        username: "実績一覧",
    },
    {
        input: [/^実績一覧$/],
        outputFunction: (input, context) => {
            return [`https://achievements.tsg.ne.jp/users/${context.user}`];
        },
        icon_emoji: ":achievement:",
        username: "実績一覧",
    },
    {
        input: [/^おみくじ$/],
        outputArray: omikuji_json_1.default,
    },
    {
        input: [/^(:([^:]+):\s?)?花火$/],
        outputFunction: (input) => {
            const matchedReaction = (input[0] === '花火') ? ':hideo54:' : `:${input[2]}:`;
            const resultString = (0, common_tags_1.stripIndent) `\
                ．　　・∵∴∵・
                　　∴※※◎※※∴
                　∴※◎☆${matchedReaction}☆◎※∴
                ・※◎${matchedReaction}＼川／${matchedReaction}◎※・
                ∵※☆＼＼Ｖ／／☆※∵
                ∴◎${matchedReaction}三＞${matchedReaction}＜三${matchedReaction}◎∴
                ∴※☆／／∧＼＼☆※∴
                ・※◎${matchedReaction}／川＼${matchedReaction}◎※・
                　∵※◎☆${matchedReaction}☆◎※∵
                　　∵※※◎※※∵
                　　　・∴∵∴・
                　　　　　ｉ
                　　　　　ｉ
                　　　　　ｉ
                　　＿　　　　　　　＿`;
            return [resultString];
        },
        icon_emoji: ":fireworks:",
        username: "鍵屋",
    },
    {
        input: [/^(?:.+か)+(?:.+)?占い$/],
        outputFunction: async (input) => {
            const str = input[0].slice(0, -2);
            const tokens = await (0, kuromojin_1.tokenize)(str);
            let choices = [''];
            for (const token of tokens) {
                if (token.pos === '助詞' && token.surface_form === 'か') {
                    choices.push('');
                }
                else {
                    choices[choices.length - 1] += token.surface_form;
                }
            }
            choices = choices.filter(choice => choice !== '');
            const fukukitarify = (c) => (0, common_tags_1.stripIndent) `\
                :meishodoto_umamusume: 「救いは無いのですか～？」
                :matikanefukukitaru_umamusume: 「むむっ…　:palms_up_together::crystal_ball:」
                :matikanefukukitaru_umamusume: 「出ました！　＊『${c.trim()}』＊です！」
            `;
            return choices.map(fukukitarify);
        },
        icon_emoji: ":camping:",
        username: "表はあっても占い",
    },
    {
        input: [/^こおしいず時間$/, /^kcztime$/, /^kczclock$/],
        outputFunction: (input) => {
            const nowBoston = (0, moment_timezone_1.default)().tz('America/New_York');
            const date = nowBoston.format('YYYY年 M月D日');
            const ampm = nowBoston.hour() < 12 ? '午前' : '午後';
            const yobi = ['日', '月', '火', '水', '木', '金', '土'][nowBoston.day()] + '曜日';
            const hour = nowBoston.hour() % 12;
            const minute = nowBoston.minute();
            return [(0, common_tags_1.stripIndent) `\
                現在のボストンの時刻は
                *${date} ${yobi} ${ampm}${hour}時${minute}分*
                だよ`];
        },
        icon_emoji: ':kczclock:',
        username: 'kcztime',
    },
    {
        input: [/^moratime$/, /^moraclock$/],
        outputFunction: (input) => {
            const nowCambridge = (0, moment_timezone_1.default)().tz('Europe/London');
            const date = nowCambridge.format('YYYY年 M月D日');
            const ampm = nowCambridge.hour() < 12 ? '午前' : '午後';
            const yobi = ['日', '月', '火', '水', '木', '金', '土'][nowCambridge.day()] + '曜日';
            const hour = nowCambridge.hour() % 12;
            const minute = nowCambridge.minute();
            return [(0, common_tags_1.stripIndent) `\
                現在のケンブリッジの時刻は
                *${date} ${yobi} ${ampm}${hour}時${minute}分*
                だよ`];
        },
        icon_emoji: ':circled_moratorium08:',
        username: 'moratime',
    },
];
exports.default = customResponses;
