"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const async_mutex_1 = require("async-mutex");
const achievements_1 = require("../achievements");
const state_1 = __importDefault(require("../lib/state"));
const config_1 = __importDefault(require("./config"));
const announceGameEnd_1 = __importDefault(require("./views/announceGameEnd"));
const announceGameStart_1 = __importDefault(require("./views/announceGameStart"));
const dialogError_1 = __importDefault(require("./views/dialogError"));
const dialogFillPiece_1 = __importDefault(require("./views/dialogFillPiece"));
const instructionGame_1 = __importDefault(require("./views/instructionGame"));
const instructionTaimai_1 = __importDefault(require("./views/instructionTaimai"));
const statusCreation_1 = __importDefault(require("./views/statusCreation"));
const statusFinished_1 = __importDefault(require("./views/statusFinished"));
const statusOngoing_1 = __importDefault(require("./views/statusOngoing"));
const mutex = new async_mutex_1.Mutex();
class Taimai {
    webClient;
    eventClient;
    messageClient;
    state;
    constructor({ webClient, eventClient, messageClient, }) {
        this.webClient = webClient;
        this.eventClient = eventClient;
        this.messageClient = messageClient;
    }
    async initialize() {
        this.state = await state_1.default.init('taimai', {
            games: [],
        });
        this.eventClient.on('message', async (message) => {
            mutex.runExclusive(() => this.onMessage(message));
        });
        for (let i = 0; i < config_1.default.placeholders.length; i++) {
            this.messageClient.action({
                type: 'button',
                actionId: `taimai_show_fill_modal_${i}`,
            }, (payload) => {
                mutex.runExclusive(() => {
                    this.showFillInPieceModal(payload);
                });
            });
        }
        this.messageClient.viewSubmission('taimai_fill_piece', (payload) => {
            mutex.runExclusive(() => {
                this.fillInPiece(payload);
            });
        });
    }
    async postMessage(message) {
        return await this.webClient.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: "玳瑁",
            icon_emoji: ":turtle:",
            text: "お使いの環境でこのメッセージは閲覧できないようです。",
            ...message,
            reply_broadcast: message.reply_broadcast ?? false,
        });
    }
    async editMessage(ts, message) {
        return await this.webClient.chat.update({
            ts,
            channel: process.env.CHANNEL_SANDBOX,
            text: "お使いの環境でこのメッセージは閲覧できないようです。",
            ...message,
        });
    }
    async showErrorModal(triggerID, message) {
        this.webClient.views.open({
            trigger_id: triggerID,
            view: (0, dialogError_1.default)(message),
        });
    }
    getGame(triggerTs) {
        return this.state.games.find(game => game.triggerTs == triggerTs);
    }
    async terminateGame(game) {
        this.state.games = this.state.games.filter(g => g.triggerTs !== game.triggerTs);
        await this.editMessage(game.statusTs, {
            ...(0, statusFinished_1.default)(game)
        });
    }
    async onMessage(message) {
        if (message.channel !== process.env.CHANNEL_SANDBOX || !message.text) {
            return;
        }
        else if (message.subtype === 'bot_message' || message.subtype === 'slackbot_response' || message.bot_id) {
            return;
        }
        const newQuestionMatch = message.text.match(config_1.default.newQuestionTrigger);
        // non-thread commands
        if (newQuestionMatch) {
            const question = newQuestionMatch.groups['question'];
            await this.initiateNewQuestion(question, message);
            return;
        }
        else if (message.text.match(config_1.default.helpTrigger)) {
            await this.showHelp(message.ts);
            return;
        }
        // in-thread commands
        const game = this.getGame(message.thread_ts);
        if (!message.thread_ts || !game || game.pieces.some(piece => !piece)) {
            return;
        }
        if (message.text.match(config_1.default.askTrigger)) {
            this.onAsk(game, message);
        }
        else if (message.text.match(config_1.default.answerTrigger)) {
            this.onAnswer(game, message);
        }
        else if (message.text.match(config_1.default.surrenderTrigger)) {
            this.onSurrender(game, message);
        }
    }
    async initiateNewQuestion(question, trigger) {
        if (this.getGame(trigger.ts)) {
            return; // duplicate message?
        }
        else if (question.length > config_1.default.maxQuestionChars) {
            await this.postMessage({ text: '問題が長すぎるよ :blob-cry:', thread_ts: trigger.ts });
            return;
        }
        else if (question.includes('[][]')) {
            await this.postMessage({ text: '成立した文章を作るために、空欄と空欄の間には少なくとも1文字入れてね :blob-cry:', thread_ts: trigger.ts });
            return;
        }
        else if (config_1.default.bannedChars.some(c => question.includes(c))) {
            await this.postMessage({ text: `使えない文字が含まれています :blob-cry:`, thread_ts: trigger.ts });
            return;
        }
        else if (config_1.default.maxConcurrentGame <= this.state.games.length) {
            await this.postMessage({ text: `同時に作成できるセッションは${config_1.default.maxConcurrentGame}個までだよ :blob-cry:`, thread_ts: trigger.ts });
            return;
        }
        let outline = question.split('[]');
        if (outline.length - 1 > config_1.default.placeholders.length) {
            await this.postMessage({ text: '空欄の個数が多すぎるよ :blob-cry:', thread_ts: trigger.ts });
            return;
        }
        (0, achievements_1.increment)(trigger.user, 'taimai-contribute-quiz');
        const pieces = Array(outline.length - 1);
        const game = {
            triggerTs: trigger.ts,
            permalink: '',
            statusTs: null,
            outline: outline,
            outlineAuthor: trigger.user,
            pieces: pieces,
            pieceAuthors: Array(outline.length - 1),
            num_questions: 0,
        };
        const message = await this.postMessage({
            thread_ts: trigger.ts,
            reply_broadcast: true,
            ...(pieces.length === 0 ? statusOngoing_1.default : statusCreation_1.default)(game)
        });
        if (pieces.length === 0) {
            await this.postMessage({
                thread_ts: trigger.ts,
                ...(0, announceGameStart_1.default)(game)
            });
            await this.postMessage({
                thread_ts: trigger.ts,
                ...(0, instructionGame_1.default)()
            });
        }
        game.statusTs = message.ts;
        const permalinkResp = await this.webClient.chat.getPermalink({ channel: trigger.channel, message_ts: message.ts });
        game.permalink = permalinkResp.permalink || '';
        this.state.games.push(game);
    }
    async showFillInPieceModal(payload) {
        const triggerTs = payload.message.root.ts;
        const triggerID = payload.trigger_id;
        const focus = Number(payload.actions[0].action_id.slice(-1));
        const game = this.getGame(triggerTs);
        if (!game) {
            this.showErrorModal(triggerID, 'このタイマイセッションは終了したか削除されました。');
            return;
        }
        else if (game.outlineAuthor == payload.user.id || game.pieceAuthors.includes(payload.user.id)) {
            this.showErrorModal(triggerID, 'あなたは既にこの問題の空欄を埋めています。');
            return;
        }
        else if (focus < 0 || game.outline.length - 1 < focus || game.pieces[focus]) {
            this.showErrorModal(triggerID, 'この空欄は既に誰かによって埋められてしまいました。');
            return;
        }
        const meta = { triggerTs, focus };
        this.webClient.views.open({
            trigger_id: triggerID,
            view: {
                private_metadata: JSON.stringify(meta),
                ...(0, dialogFillPiece_1.default)(game, focus)
            },
        });
    }
    async fillInPiece(payload) {
        const stateObjects = Object.values(payload?.view?.state?.values ?? {});
        const state = Object.assign({}, ...stateObjects);
        const piece = state['taimai_fill_piece'].value;
        const { triggerTs, focus } = JSON.parse(payload?.view?.private_metadata);
        const game = this.getGame(triggerTs);
        const triggerID = payload.trigger_id;
        if (!game) {
            this.showErrorModal(triggerID, 'このタイマイセッションは終了したか削除されました。');
            return;
        }
        else if (game.outlineAuthor == payload.user.id || game.pieceAuthors.includes(payload.user.id)) {
            this.showErrorModal(triggerID, 'あなたは既にこの問題の空欄を埋めています。');
            return;
        }
        else if (focus < 0 || game.outline.length - 1 < focus || game.pieces[focus]) {
            this.showErrorModal(triggerID, 'この空欄は既に誰かによって埋められてしまいました。');
            return;
        }
        else if (piece.length > config_1.default.maxPieceChars) {
            this.showErrorModal(triggerID, '文字数が多すぎます。');
            return;
        }
        else if (piece.length === 0) {
            this.showErrorModal(triggerID, '文字数が少なすぎます。');
            return;
        }
        game.pieceAuthors[focus] = payload.user.id;
        game.pieces[focus] = piece;
        await this.postMessage({
            text: `<@${payload.user.id}>が${config_1.default.placeholders[focus]}番の空欄を埋めた :turtle:`,
            thread_ts: triggerTs,
            reply_broadcast: true
        });
        (0, achievements_1.increment)(payload.user.id, 'taimai-contribute-quiz');
        if (game.pieces.every(p => p)) {
            await this.editMessage(game.statusTs, {
                ...(0, statusOngoing_1.default)(game)
            });
            await this.postMessage({
                thread_ts: triggerTs,
                reply_broadcast: true,
                ...(0, announceGameStart_1.default)(game)
            });
            await this.postMessage({
                thread_ts: triggerTs,
                ...(0, instructionGame_1.default)()
            });
        }
        else {
            await this.editMessage(game.statusTs, {
                ...(0, statusCreation_1.default)(game)
            });
        }
    }
    async onAsk(game, payload) {
        if (Math.random() < config_1.default.askProbability) {
            this.webClient.reactions.add({
                name: 'o',
                channel: payload.channel,
                timestamp: payload.ts,
            });
        }
        else {
            this.webClient.reactions.add({
                name: 'x',
                channel: payload.channel,
                timestamp: payload.ts,
            });
        }
        (0, achievements_1.increment)(payload.user, 'taimai-ask');
        game.num_questions++;
    }
    async onAnswer(game, payload) {
        const c = config_1.default.answerProbability;
        const x = game.num_questions;
        const p = (c.max - c.min) * (1 - 2 / (Math.exp(c.grow * x) + Math.exp(-c.grow * x))) + c.min;
        game.num_questions++;
        if (Math.random() >= p) {
            this.webClient.reactions.add({
                name: 'x',
                channel: payload.channel,
                timestamp: payload.ts,
            });
            return;
        }
        const answer = payload.text.match(config_1.default.answerTrigger).groups['answer'];
        game.answer = answer;
        game.answerAuthor = payload.user;
        await this.terminateGame(game);
        await this.postMessage({
            thread_ts: game.triggerTs,
            reply_broadcast: true,
            ...(0, announceGameEnd_1.default)(game)
        });
        await this.webClient.reactions.add({
            name: 'o',
            channel: payload.channel,
            timestamp: payload.ts,
        });
        (0, achievements_1.increment)(payload.user, 'taimai-correct-answer');
        if (game.num_questions === 0) {
            (0, achievements_1.increment)(payload.user, 'taimai-0q');
        }
        if (game.num_questions <= 3) {
            (0, achievements_1.increment)(payload.user, 'taimai-lt3q');
        }
        if (game.num_questions >= 25) {
            (0, achievements_1.increment)(payload.user, 'taimai-gt25q');
        }
    }
    async onSurrender(game, payload) {
        game.answer = config_1.default.ultimateAnswer;
        game.answerAuthor = payload.user;
        await this.terminateGame(game);
        await this.postMessage({
            thread_ts: game.triggerTs,
            reply_broadcast: true,
            ...(0, announceGameEnd_1.default)(game)
        });
        await this.webClient.reactions.add({
            name: 'o',
            channel: payload.channel,
            timestamp: payload.ts,
        });
    }
    async showHelp(threadTs = null) {
        await this.postMessage({ thread_ts: threadTs, ...(0, instructionTaimai_1.default)(this.state.games) });
    }
}
exports.default = async ({ webClient, messageClient, eventClient }) => {
    const taimai = new Taimai({ webClient, messageClient, eventClient });
    await taimai.initialize();
};
