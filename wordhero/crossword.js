"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = crossword;
const cloudinary_1 = __importDefault(require("cloudinary"));
const common_tags_1 = require("common-tags");
// @ts-expect-error
const japanese_1 = require("japanese");
const p_queue_1 = __importDefault(require("p-queue"));
const render_1 = require("./render");
const generateCrossword_1 = __importDefault(require("./generateCrossword"));
const generateGrossword_1 = __importDefault(require("./generateGrossword"));
const achievements_1 = require("../achievements");
const channelLimitedBot_1 = require("../lib/channelLimitedBot");
const slackUtils_1 = require("../lib/slackUtils");
const uploadImage = async (board, boardId) => {
    const imageData = await (0, render_1.renderCrossword)(board, boardId);
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
    return cloudinaryData;
};
const updatesQueue = new p_queue_1.default({ concurrency: 1 });
const colors = [
    '#FF6F00',
    '#7E57C2',
    '#0288D1',
    '#388E3C',
    '#F44336',
    '#6D4C41',
    '#EC407A',
    '#01579B',
    '#00838F',
    '#558B2F',
    '#8D6E63',
    '#AB47BC',
    '#1E88E5',
    '#009688',
    '#827717',
    '#E65100',
];
const getColor = (isGrossword, descriptionId) => {
    if (isGrossword) {
        return descriptionId.startsWith('タテ') ? colors[2] : colors[4];
    }
    return colors[parseInt(descriptionId) % colors.length];
};
class CrosswordBot extends channelLimitedBot_1.ChannelLimitedBot {
    state = {
        thread: null,
        channel: null,
        isHolding: false,
        isGrossword: false,
        crossword: null,
        board: [],
        hitWords: [],
        timeouts: [],
        users: new Set(),
        contributors: new Set(),
        endTime: 0,
        misses: new Map(),
    };
    wakeWordRegex = /^(crossword|grossword)$/i;
    username = 'crossword';
    iconEmoji = ':capital_abcd:';
    async onWakeWord(message, channel) {
        if (this.state.isHolding) {
            return null;
        }
        const isGrossword = Boolean(message.text.match(/^grossword$/i));
        const crossword = await (isGrossword ? (0, generateGrossword_1.default)(message.ts) : (0, generateCrossword_1.default)(message.ts));
        if (crossword === null) {
            await this.slack.chat.postMessage({
                channel,
                text: (0, common_tags_1.stripIndent) `
					grosswordのタネがないよ:cry:
				`,
                username: 'crossword',
                icon_emoji: ':capital_abcd:',
            });
            return null;
        }
        this.state.isGrossword = isGrossword;
        this.state.isHolding = true;
        this.state.board = new Array(400).fill(null);
        this.state.hitWords = [];
        this.state.timeouts = [];
        this.state.users = new Set();
        this.state.contributors = new Set();
        this.state.crossword = crossword;
        this.state.misses = new Map();
        const cloudinaryData = await uploadImage([], this.state.crossword.boardId);
        const seconds = this.state.crossword.constraints.length * 10;
        const { ts } = await this.slack.chat.postMessage({
            channel,
            text: (0, common_tags_1.stripIndent) `
				楽しいクロスワードパズルを始めるよ～
				マスに入ると思う単語を${seconds}秒以内に *スレッドで* 返信してね!
			`,
            username: 'crossword',
            icon_emoji: ':capital_abcd:',
            attachments: [{
                    title: this.state.isGrossword ? 'Grossword' : 'Crossword',
                    image_url: cloudinaryData.secure_url,
                }, ...this.state.crossword.descriptions.map(({ description, descriptionId }) => {
                    const cells = this.state.crossword.constraints.find((constraint) => constraint.descriptionId === descriptionId).cells;
                    return {
                        text: `${descriptionId}. ${cells.map((cell) => this.state.board[cell] || '◯').join('')}: ${description}`,
                        color: getColor(this.state.isGrossword, descriptionId),
                    };
                })],
        });
        this.state.thread = ts;
        this.state.channel = channel;
        await this.slack.chat.postMessage({
            channel,
            text: 'ここにお願いします！',
            thread_ts: ts,
            username: 'crossword',
            icon_emoji: ':capital_abcd:',
        });
        this.state.timeouts.push(setTimeout(async () => {
            this.state.thread = null;
            await this.slack.chat.postMessage({
                channel,
                text: '～～～～～～～～～～おわり～～～～～～～～～～',
                thread_ts: ts,
                username: 'crossword',
                icon_emoji: ':capital_abcd:',
            });
            await this.deleteProgressMessage(ts);
            const cloudinaryData = await uploadImage(this.state.crossword.board.map((letter, index) => ({
                color: this.state.board[index] === null ? 'gray' : 'black',
                letter,
            })), this.state.crossword.boardId);
            await this.slack.chat.postMessage({
                channel,
                text: (0, common_tags_1.stripIndent) `
					残念、クリアならず:cry:
				`,
                username: 'crossword',
                icon_emoji: ':capital_abcd:',
                thread_ts: ts,
                reply_broadcast: true,
                attachments: [{
                        title: this.state.isGrossword ? 'Grossword' : 'Crossword',
                        image_url: cloudinaryData.secure_url,
                    }, ...this.state.crossword.descriptions.map(({ word, ruby, description, descriptionId }) => ({
                        text: `${descriptionId}. ${word} (${ruby}): ${description}`,
                        color: this.state.hitWords.includes(ruby) ? '#FF6F00' : '',
                    }))],
            });
            this.state.isHolding = false;
        }, seconds * 1000));
        this.state.endTime = Date.now() + seconds * 1000;
        return ts ?? null;
    }
    async onMessageEvent(event) {
        await super.onMessageEvent(event);
        const message = (0, slackUtils_1.extractMessage)(event);
        if (message === null ||
            !message.text ||
            message.subtype) {
            return;
        }
        const remainingTime = this.state.endTime - Date.now();
        if ('thread_ts' in message && message.thread_ts === this.state.thread) {
            const word = (0, japanese_1.hiraganize)(message.text);
            const isFirstAnswer = !this.state.users.has(message.user);
            this.state.users.add(message.user);
            if (!this.state.crossword.words.includes(word) || this.state.hitWords.includes(word)) {
                if (!this.state.misses.has(message.user)) {
                    this.state.misses.set(message.user, 0);
                }
                this.state.misses.set(message.user, this.state.misses.get(message.user) + 1);
                await this.slack.reactions.add({
                    name: 'no_good',
                    channel: message.channel,
                    timestamp: message.ts,
                });
                return;
            }
            const oldOpenCells = this.state.board.filter((cell) => cell !== null).length;
            const newIndices = new Set();
            for (const description of this.state.crossword.descriptions) {
                if (word === description.ruby) {
                    for (const letterIndex of this.state.crossword.constraints.find((constraint) => constraint.descriptionId === description.descriptionId).cells) {
                        newIndices.add(letterIndex);
                        this.state.board[letterIndex] = this.state.crossword.board[letterIndex];
                    }
                }
            }
            const newOpenCells = this.state.board.filter((cell) => cell !== null).length;
            this.state.hitWords = this.state.crossword.descriptions.filter((description) => {
                const cells = this.state.crossword.constraints.find((constraint) => constraint.descriptionId === description.descriptionId).cells;
                return cells.every((cell) => this.state.board[cell] !== null);
            }).map((description) => description.ruby);
            (0, achievements_1.increment)(message.user, 'crossword-cells', newOpenCells - oldOpenCells);
            this.state.contributors.add(message.user);
            if (this.state.board.every((cell, index) => this.state.crossword.board[index] === null || cell !== null)) {
                for (const timeout of this.state.timeouts) {
                    clearTimeout(timeout);
                }
                const thread = this.state.thread;
                const channel = this.state.channel;
                this.state.thread = null;
                this.state.channel = null;
                this.state.isHolding = false;
                await this.slack.reactions.add({
                    name: 'tada',
                    channel: message.channel,
                    timestamp: message.ts,
                });
                await this.deleteProgressMessage(thread);
                const cloudinaryData = await uploadImage(this.state.crossword.board.map((letter) => ({
                    color: 'red',
                    letter,
                })), this.state.crossword.boardId);
                await this.slack.chat.postMessage({
                    channel,
                    text: (0, common_tags_1.stripIndent) `
						クリア！:raised_hands:
					`,
                    username: 'crossword',
                    icon_emoji: ':capital_abcd:',
                    thread_ts: thread,
                    reply_broadcast: true,
                    attachments: [{
                            title: this.state.isGrossword ? 'Grossword' : 'Crossword',
                            image_url: cloudinaryData.secure_url,
                        }, ...this.state.crossword.descriptions.map(({ word, ruby, description }, index) => ({
                            text: `${index + 1}. ${word} (${ruby}): ${description}`,
                            color: this.state.hitWords.includes(ruby) ? '#FF6F00' : '',
                        }))],
                });
                await (0, achievements_1.unlock)(message.user, 'crossword-clear');
                for (const user of this.state.contributors) {
                    await (0, achievements_1.increment)(user, 'crossword-wins');
                    if (this.state.isGrossword) {
                        await (0, achievements_1.increment)(user, 'grossword-wins');
                    }
                    if (this.state.contributors.size >= 11) {
                        await (0, achievements_1.unlock)(user, 'crossword-contributors-ge-11');
                    }
                    if (remainingTime >= this.state.crossword.constraints.length * 10000 * 0.75) {
                        await (0, achievements_1.unlock)(user, 'crossword-game-time-le-quarter');
                    }
                }
                for (const [user, misses] of this.state.misses) {
                    if (misses >= 20 && !this.state.contributors.has(user)) {
                        await (0, achievements_1.unlock)(user, 'crossword-misses-ge-20');
                    }
                }
                if (this.state.contributors.size === 1) {
                    await (0, achievements_1.unlock)(message.user, 'crossword-solo');
                }
                if (isFirstAnswer) {
                    await (0, achievements_1.unlock)(message.user, 'crossword-closer');
                }
                if (remainingTime <= 2000) {
                    await (0, achievements_1.unlock)(message.user, 'crossword-buzzer-beater');
                }
            }
            else {
                this.slack.reactions.add({
                    name: '+1',
                    channel: message.channel,
                    timestamp: message.ts,
                });
                const ts = this.state.thread;
                const channel = this.state.channel;
                await updatesQueue.add(async () => {
                    const cloudinaryData = await uploadImage(this.state.board.map((letter, index) => (letter === null ? null : {
                        color: newIndices.has(index) ? 'red' : 'black',
                        letter,
                    })), this.state.crossword.boardId);
                    const seconds = this.state.crossword.constraints.length * 10;
                    await this.slack.chat.update({
                        channel,
                        text: (0, common_tags_1.stripIndent) `
							楽しいクロスワードパズルを始めるよ～
							マスに入ると思う単語を${seconds}秒以内に *スレッドで* 返信してね!
						`,
                        ts,
                        attachments: [{
                                title: this.state.isGrossword ? 'Grossword' : 'Crossword',
                                image_url: cloudinaryData.secure_url,
                            }, ...this.state.crossword.descriptions.map(({ description, ruby, descriptionId }, index) => {
                                const cells = this.state.crossword.constraints.find((constraint) => constraint.descriptionId === descriptionId).cells;
                                return {
                                    text: `${descriptionId}. ${cells.map((cell) => this.state.board[cell] || '◯').join('')}: ${description}`,
                                    ruby,
                                    color: getColor(this.state.isGrossword, descriptionId),
                                };
                            }).filter(({ ruby }) => (!this.state.hitWords.includes(ruby)))],
                    });
                });
            }
        }
    }
}
async function crossword(slackClients) {
    new CrosswordBot(slackClients);
}
;
