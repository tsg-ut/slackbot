"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const util_1 = require("util");
const path_1 = __importDefault(require("path"));
const assert_1 = __importDefault(require("assert"));
const lodash_1 = require("lodash");
// @ts-expect-error
const trie_1 = __importDefault(require("./trie"));
const cloudinary_1 = __importDefault(require("cloudinary"));
const common_tags_1 = require("common-tags");
// @ts-expect-error
const japanese_1 = require("japanese");
// @ts-expect-error
const download_1 = __importDefault(require("download"));
const sqlite = __importStar(require("sqlite"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const render_1 = __importDefault(require("./render"));
const utils_1 = require("../lib/utils");
const hiraganaLetters = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー'.split('');
const getPrecedings = (index) => {
    const ret = [];
    const hasRight = index % 4 !== 3;
    const hasLeft = index % 4 !== 0;
    const hasUp = index >= 4;
    const hasDown = index < 12;
    if (hasRight) {
        ret.push(index + 1);
    }
    if (hasLeft) {
        ret.push(index - 1);
    }
    if (hasUp) {
        ret.push(index - 4);
    }
    if (hasDown) {
        ret.push(index + 4);
    }
    if (hasRight && hasUp) {
        ret.push(index - 3);
    }
    if (hasRight && hasDown) {
        ret.push(index + 5);
    }
    if (hasLeft && hasUp) {
        ret.push(index - 5);
    }
    if (hasLeft && hasDown) {
        ret.push(index + 3);
    }
    return ret;
};
const precedingsList = Array(16).fill(0).map((_, index) => getPrecedings(index));
const getPrefixedWords = (treeNode, letters, prefix, bitmask, index, minLength) => {
    const ret = [];
    if (minLength <= prefix.length && treeNode.isTerminal()) {
        ret.push(prefix);
    }
    for (const preceding of precedingsList[index]) {
        if ((bitmask & (1 << preceding)) !== 0) {
            continue;
        }
        const letter = letters[preceding];
        if (letter === null) {
            continue;
        }
        if (!treeNode.step(letter)) {
            continue;
        }
        ret.push(...getPrefixedWords(treeNode, letters, prefix + letter, bitmask | (1 << preceding), preceding, minLength));
        treeNode.back();
    }
    return ret;
};
const getWords = (tree, letters, minLength) => {
    const set = new Set();
    const treeNode = tree.tree();
    for (const index of letters.keys()) {
        if (letters[index] === null) {
            continue;
        }
        if (!treeNode.step(letters[index])) {
            continue;
        }
        const words = getPrefixedWords(treeNode, letters, letters[index], 1 << index, index, minLength);
        treeNode.back();
        for (const word of words) {
            set.add(word);
        }
    }
    return Array.from(set);
};
const generateBoard = (tree, seed) => {
    (0, assert_1.default)(seed.length <= 10);
    let board = null;
    while (board === null) {
        const tempBoard = Array(16).fill(null);
        let pointer = (0, lodash_1.random)(0, 15);
        let failed = false;
        for (const index of Array(seed.length).keys()) {
            tempBoard[pointer] = seed[index];
            if (index !== seed.length - 1) {
                const precedings = precedingsList[pointer].filter((cell) => tempBoard[cell] === null);
                if (precedings.length === 0) {
                    failed = true;
                    break;
                }
                pointer = (0, lodash_1.sample)(precedings);
            }
        }
        if (!failed) {
            board = tempBoard;
        }
    }
    while (board.some((letter) => letter === null)) {
        const [targetCellIndex] = (0, lodash_1.sample)([...board.entries()].filter(([, letter]) => letter === null));
        const prefixes = [];
        for (const preceding of precedingsList[targetCellIndex]) {
            if (board[preceding] === null) {
                continue;
            }
            prefixes.push(board[preceding]);
            for (const preceding2 of precedingsList[preceding]) {
                if (board[preceding2] === null || preceding === preceding2) {
                    continue;
                }
                prefixes.push(board[preceding2] + board[preceding]);
            }
        }
        if (prefixes.length <= 4) {
            continue;
        }
        const counter = new Map(hiraganaLetters.map((letter) => [letter, 0]));
        for (const prefix of prefixes) {
            for (const nextLetter of hiraganaLetters) {
                counter.set(nextLetter, counter.get(nextLetter) + tree.getPrefix(prefix + nextLetter, 0, 5));
            }
        }
        const topLetters = (0, lodash_1.sortBy)(Array.from(counter.entries()), ([, count]) => count).reverse().slice(0, 3);
        const [nextLetter] = (0, lodash_1.sample)(topLetters);
        board[targetCellIndex] = nextLetter;
    }
    return board;
};
const generateHardBoard = (tree, seed) => {
    (0, assert_1.default)(seed.length <= 12);
    let board = null;
    while (board === null) {
        const tempBoard = Array(16).fill(null);
        let pointer = (0, lodash_1.random)(0, 15);
        let failed = false;
        for (const index of Array(seed.length).keys()) {
            tempBoard[pointer] = seed[index];
            if (index !== seed.length - 1) {
                const precedings = precedingsList[pointer].filter((cell) => tempBoard[cell] === null);
                if (precedings.length === 0) {
                    failed = true;
                    break;
                }
                pointer = (0, lodash_1.sample)(precedings);
            }
        }
        if (!failed) {
            board = tempBoard;
        }
    }
    while (board.some((letter) => letter === null)) {
        const [targetCellIndex] = (0, lodash_1.sample)([...board.entries()].filter(([, letter]) => letter === null));
        const counter = new Map(hiraganaLetters.map((letter) => {
            const newBoard = board.slice();
            newBoard[targetCellIndex] = letter;
            return [letter, (0, lodash_1.sumBy)(getWords(tree, newBoard, 5), (word) => word.length ** 2)];
        }));
        const [nextLetter] = (0, lodash_1.maxBy)((0, lodash_1.shuffle)(Array.from(counter.entries())), ([, count]) => count);
        board[targetCellIndex] = nextLetter;
    }
    return board;
};
const loadDeferred = new utils_1.Deferred();
const load = async () => {
    if (loadDeferred.isResolved) {
        return loadDeferred.promise;
    }
    for (const file of ['words.txt', 'dictionary.sqlite3', 'LOUDS_LBS.bin', 'LOUDS_label.txt', 'LOUDS_terminal.bin']) {
        const filePath = path_1.default.resolve(__dirname, file);
        const exists = await new Promise((resolve) => {
            fs_1.default.access(filePath, fs_1.default.constants.F_OK, (error) => {
                resolve(!error);
            });
        });
        if (!exists) {
            await (0, download_1.default)(`https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/${file}`, __dirname, {
                filename: file,
            });
        }
    }
    const data = await (0, util_1.promisify)(fs_1.default.readFile)(path_1.default.join(__dirname, 'words.txt'));
    const dictionary = data.toString().split('\n').filter((s) => (typeof s === 'string' && 2 <= s.length && s.length <= 16));
    const seedWords = dictionary.filter((word) => 7 <= word.length && word.length <= 8);
    const hardSeedWords = dictionary.filter((word) => 9 <= word.length && word.length <= 10);
    const rawTrie = {
        LBS: await (0, util_1.promisify)(fs_1.default.readFile)(path_1.default.join(__dirname, 'LOUDS_LBS.bin')),
        label: await (0, util_1.promisify)(fs_1.default.readFile)(path_1.default.join(__dirname, 'LOUDS_label.txt')),
        terminal: await (0, util_1.promisify)(fs_1.default.readFile)(path_1.default.join(__dirname, 'LOUDS_terminal.bin'))
    };
    const tree = (0, trie_1.default)(rawTrie);
    const db = await sqlite.open({
        filename: path_1.default.join(__dirname, 'dictionary.sqlite3'),
        driver: sqlite3_1.default.Database,
    });
    return loadDeferred.resolve({ seedWords, hardSeedWords, tree, db });
};
exports.default = async ({ eventClient, webClient: slack }) => {
    const state = {
        thread: null,
        isHolding: false,
        words: [],
        users: {},
    };
    eventClient.on('message', async (message) => {
        if (!message.text || message.subtype || message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (message.thread_ts && message.thread_ts === state.thread) {
            const word = (0, japanese_1.hiraganize)(message.text);
            if (!state.words.includes(word)) {
                await slack.reactions.add({
                    name: 'no_good',
                    channel: message.channel,
                    timestamp: message.ts,
                });
                return;
            }
            if (Object.values(state.users).some((words) => words.includes(word))) {
                await slack.reactions.add({
                    name: 'innocent',
                    channel: message.channel,
                    timestamp: message.ts,
                });
                return;
            }
            if (!state.users[message.user]) {
                state.users[message.user] = [];
            }
            state.users[message.user].push(word);
            await slack.reactions.add({
                name: '+1',
                channel: message.channel,
                timestamp: message.ts,
            });
            return;
        }
        if (message.text.match(/^wordhero$/i) || message.text.match(/^hardhero$/i)) {
            if (state.isHolding) {
                return;
            }
            const isHard = Boolean(message.text.match(/^hardhero$/i));
            const { seedWords, hardSeedWords, tree, db } = await load();
            state.isHolding = true;
            const board = isHard ? generateHardBoard(tree, (0, lodash_1.sample)(hardSeedWords)) : generateBoard(tree, (0, lodash_1.sample)(seedWords));
            state.words = (isHard ? getWords(tree, board, 5) : getWords(tree, board, 1)).filter((word) => word.length >= 3);
            const imageData = await (0, render_1.default)(board, { color: isHard ? '#D50000' : 'black' });
            const cloudinaryData = await new Promise((resolve, reject) => {
                cloudinary_1.default.v2.uploader
                    .upload_stream({ resource_type: 'image' }, (error, response) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve(response);
                    }
                })
                    .end(imageData);
            });
            const { ts } = await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: '今から30秒後にWordHeroを始めるよ～ 準備はいいかな～?',
                username: 'wordhero',
                icon_emoji: ':capital_abcd:',
            });
            await new Promise((resolve) => {
                setTimeout(resolve, 30 * 1000);
            });
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: (0, common_tags_1.stripIndent) `
					この画像から同じ場所を通らずタテ・ヨコ・ナナメにたどって見つけた3文字以上の単語を
					90秒以内に *スレッドで* 返信してね!
					${isHard ? ':face_with_symbols_on_mouth: *HARD MODE: 5文字以上限定!*' : ''}
				`,
                username: 'wordhero',
                icon_emoji: ':capital_abcd:',
                thread_ts: ts,
                reply_broadcast: true,
                attachments: [{
                        title: 'WordHero',
                        image_url: cloudinaryData.secure_url,
                    }],
            });
            state.thread = ts;
            setTimeout(async () => {
                state.thread = null;
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: '～～～～～～～～～～おわり～～～～～～～～～～',
                    thread_ts: ts,
                    username: 'wordhero',
                    icon_emoji: ':capital_abcd:',
                });
                const ranking = Object.entries(state.users).map(([user, words]) => ({
                    user,
                    words,
                    point: (0, lodash_1.sum)(words.map((word) => word.length ** 2)),
                })).sort((a, b) => b.point - a.point);
                const appearedWords = new Set((0, lodash_1.flatten)(Object.values(state.users)));
                const wordList = [];
                for (const word of (0, lodash_1.sortBy)(state.words.reverse(), (word) => word.length).reverse()) {
                    const entry = appearedWords.has(word) ? `*${word}*` : word;
                    const data = await db.get('SELECT * FROM words WHERE ruby = ?', word);
                    if (word.length >= 5) {
                        if (data.description) {
                            wordList.push(`${entry} (${data.word}): _${data.description}_`);
                        }
                        else {
                            wordList.push(`${entry} (${data.word})`);
                        }
                    }
                    else {
                        wordList.push(`${entry} (${data.word})`);
                    }
                }
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: (0, common_tags_1.stripIndent) `
						結果発表～
					`,
                    username: 'wordhero',
                    icon_emoji: ':capital_abcd:',
                    attachments: [
                        ...ranking.map(({ user, words, point }, index) => ({
                            text: `${index + 1}位. <@${user}> ${point}点 (${words.join('、')})`,
                            color: index === 0 ? 'danger' : '#EEEEEE',
                        })),
                        {
                            title: `単語一覧 (計${state.words.length}個)`,
                            text: wordList.join('\n'),
                        },
                    ],
                });
                state.isHolding = false;
                state.users = {};
            }, 90 * 1000);
            return;
        }
    });
};
