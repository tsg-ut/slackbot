import { stripIndent } from 'common-tags';
// @ts-expect-error
import { romanize, katakanize } from 'japanese';
import { shuffle } from 'lodash';
import omikuji from './omikuji.json';

interface Achievement {
    trigger: RegExp[],
    name: string,
}

export interface Context {
    user: string,
}

export interface CustomResponse {
    input: RegExp[],
    outputArray?: string[],
    outputFunction?: ((input: string[], context: Context) => string[] | Promise<string[]>),
    shuffle?: true,
    username?: string,
    icon_emoji?: string,
    reaction?: true,
    achievements?: Achievement[],
}

const customResponses: CustomResponse[] = [
    {
        input: [/^[あほくさ]{4}$/],
        outputFunction: (input: string[]) => {
            const ahokusaMap = new Map([
                ['あ', 'ahokusa-top-right'],
                ['ほ', 'ahokusa-bottom-right'],
                ['く', 'ahokusa-top-left'],
                ['さ', 'ahokusa-bottom-left'],
            ]);
            const [a, ho, ku, sa] = Array.from(input[0]).map((c: string, i, a) => ahokusaMap.get(c));
            const outputStr = `:${ku}::ahokusa-top-center::${a}:\n:${sa}::ahokusa-bottom-center::${ho}:`
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
        input: [/^(\d+)d(\d+)$/],
        outputFunction: (input: string[]) => {
            const diceCount = Number(input[1]);
            const diceUpper = Number(input[2]);
            let retString = "";
            let result = 0;
            if (diceCount > 2000) return null;
            for (let diceIndex = 0; diceIndex < diceCount; ++diceIndex) {
                const face = Math.floor(Math.random() * diceUpper) + 1;
                retString += face.toString() + " ";
                result += face;
            }
            if(retString.length > 3000)retString = retString.slice(0, 1997) + "... ";
            retString += "= " + result.toString();
            return [retString];
        },
        username: 'dice response',
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
        outputFunction: input => [ stripIndent`
            ${input[1]}っちへ

            ういっすー!
            朝から、完全にぽんぽんぺいんで、つらみが深いので、1日おふとんでスヤァしておきます。
            明日は行けたら行くマンです!` ],
        icon_emoji: ':shakaijin-ichinensei:',
        username: '社会人一年生',
    },
    {
        input: [/^(.+)ぴへ$/],
        outputFunction: input => [ stripIndent`
            ${input[1]}ぴへ

            なんかバイブス上げてくの
            最近ムリムリのムリで
            ぴえんこえてぱおん🐘💔

            もうまじ退職しか勝たんから
            明日からはおうちカフェで
            働くことにしました🐰

            いままで397❤❤
            また会おーね👋😃` ],
        icon_emoji: ':shakaijin-ichinensei:',
        username: '社会人一年生',
    },
    {
        input: [/(sa|さ|サ)(l|ー)?(mo|も|モ)(n|ん|ン)/i],
        outputArray: ['sushi-salmon'],
        reaction: true,
    },
    ... ['まぐろ', 'たまご', 'えび', 'とろ', 'いくら', 'たい', 'うに', 'いか'].map((neta): CustomResponse => {
        const regexStr = Array.from(neta)
            .map((char) => `(${char}|${romanize(char)}|${katakanize(char)})`)
            .join('');
        return {
            input: [new RegExp(regexStr, 'i')],
            outputArray: [`sushi-${romanize(neta)}`],
            reaction: true,
        };
    }),
    {
        input: [/^:question:$/],
        outputFunction: (input: string[]) => {
            let thres = 0.83;
            let randv = Math.random();
            if(randv < thres){
                return [':exclamation:'];
            } else {
                return [':exclamation_w:'];
            }
        },
        icon_emoji: ':kadokawa:',
        username: 'KADOKAWA',
    },
    {
        input: [/デニム/],
        outputFunction: (input: string[]) => {
            const lane = shuffle([1, 2, 3, 4, 5, 6, 7]);
            const white = "|　　|" + lane.map((i: number) => (i % 2 === 1) ? "＿|" : "　|").join("");
            const black = "|　　|" + lane.map((i: number) => (i % 2 === 0) ? "＿|" : "　|").join("");
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
        outputFunction: (input: string[]) => {
            return [`https://achievements.tsg.ne.jp/users/${input[1]}`];
        },
        icon_emoji: ":achievement:",
        username: "実績一覧",
    },
    {
        input: [/^実績一覧$/],
        outputFunction: (input: string[], context: Context) => {
            return [`https://achievements.tsg.ne.jp/users/${context.user}`];
        },
        icon_emoji: ":achievement:",
        username: "実績一覧",
    },
    {
        input: [/^おみくじ$/],
        outputArray: omikuji,
    },
    {
        input: [/^(:([^:]+):\s?)?花火$/],
        outputFunction: (input: string[]) => {
            const matchedReaction = (input[0] === '花火') ? ':hideo54:' : `:${input[2]}:`;
            const resultString = stripIndent`\
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
        outputFunction: (input: string[]) => {
            const matchedString = input[0];
            const choice = (() =>{
                const lackChoice = [...matchedString.matchAll(/(.+?)か/g)].map(m => m[1]);
                const lastIndex = lackChoice.join('か').length;
                if(lastIndex < matchedString.length - 3){
                    return lackChoice.concat([matchedString.slice(lastIndex + 1, matchedString.length - 2)]);
                } else {
                    return lackChoice;
                }
            })();
            const fukukitarify = (c: string) => {
                return stripIndent`\
                :meishodoto_umamusume: 「救いは無いのですか～？」
                :matikanefukukitaru_umamusume: 「むむっ…　:palms_up_together::crystal_ball:」
                :matikanefukukitaru_umamusume: 「出ました！　＊『${c.trim()}』＊です！」
                `;
            }
            return choice.map(fukukitarify);
        },
        icon_emoji: ":camping:",
        username: "表はあっても占い",
    },
];

export default customResponses;
