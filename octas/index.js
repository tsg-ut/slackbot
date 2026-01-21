"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../lib/logger"));
const cloudinary_1 = __importDefault(require("cloudinary"));
const sharp_1 = __importDefault(require("sharp"));
const path_1 = __importDefault(require("path"));
const common_tags_1 = require("common-tags");
// @ts-expect-error
const Board_1 = __importDefault(require("./lib/Board"));
// @ts-expect-error
const Render_1 = __importDefault(require("./lib/Render"));
const jsdom_1 = require("jsdom");
const p_queue_1 = __importDefault(require("p-queue"));
const index_js_1 = require("../achievements/index.js");
const log = logger_1.default.child({ bot: 'octas' });
const applyCSS = (paper) => {
    paper.selectAll('.board-edge').attr({
        'stroke': '#009900',
        'fill': '#ffffff',
        'stroke-width': 6
    });
    paper.selectAll('.board-point').attr({
        'fill': '#006600',
        'stroke': 'none'
    });
    paper.selectAll('.board-goal').attr({
        'stroke-width': 2
    });
    paper.select('.board-goal.player-a').attr({
        'stroke': '#ff0000',
        'fill': '#ff6666'
    });
    paper.select('.board-goal.player-b').attr({
        'stroke': '#0000ff',
        'fill': '#6666ff'
    });
    paper.select('.current-point').attr({
        'fill': '#ee77ee'
    });
    paper.selectAll('.trace-line').attr({
        'fill': 'none',
        'stroke': '#000000',
        'stroke-width': 1.5
    });
    paper.selectAll('.arrow').attr({
        'stroke-width': 1
    });
    paper.selectAll('.active-a .arrow').attr({
        'fill': '#ff4444',
        'stroke': '#d10000'
    });
    paper.selectAll('.active-b .arrow').attr({
        'fill': '#4444ff',
        'stroke': '#0000d1'
    });
    paper.selectAll('.triangle').attr({
        'fill': '#00ff00',
        'stroke': '#006600',
        'stroke-width': 1
    });
};
const uploadImage = async (paper) => {
    applyCSS(paper);
    const svg = Buffer.from(paper.toString());
    const png = await (0, sharp_1.default)(svg).png().toBuffer();
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
            .end(png);
    });
    return cloudinaryData;
};
const processQueue = new p_queue_1.default({ concurrency: 1 });
exports.default = async ({ eventClient, webClient: slack }) => {
    const state = {
        thread: null,
        isHolding: false,
        isGaming: false,
        player: null,
        opponent: null,
        board: null,
        paper: null,
        element: null,
    };
    const dom = await new Promise((resolve, reject) => {
        const resource = path_1.default.join(__dirname, "../node_modules/snapsvg/dist/snap.svg.js");
        const dom = new jsdom_1.JSDOM(`
                <!DOCTYPE html><html>
                <body><div id="test"></div></body></html>
            `, {
            runScripts: "dangerously",
            resources: "usable",
        });
        const script = dom.window.document.createElement('script');
        script.src = `file://${resource}`;
        script.onload = () => resolve(dom);
        script.onerror = reject;
        const head = dom.window.document.getElementsByTagName('head')[0];
        head.appendChild(script);
    });
    const Pardon = async (message) => {
        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: message,
            thread_ts: state.thread,
            username: 'octas',
            icon_emoji: ':ha:'
        });
    };
    const Halt = () => {
        state.thread = null;
        state.isHolding = false;
        state.isGaming = false;
        state.player = null;
        state.opponent = null;
        state.board = null;
        state.paper = null;
        state.element = null;
    };
    const Launch = async () => {
        log.info('[OCTAS] instance launched.');
        state.isHolding = true;
        state.board = new Board_1.default({ width: 5, height: 5 });
        state.paper = dom.window.Snap();
        state.element = new Render_1.default(state.board, state.paper, dom.window.Snap);
        const cloudinaryData = await uploadImage(state.paper);
        const { ts } = await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: (0, common_tags_1.stripIndent) `
                Octas対人を始めるよ～
                スレッドに「先手」か「後手」と返信して参加しよう！
            `,
            attachments: [{
                    title: 'octas',
                    image_url: cloudinaryData.secure_url
                }],
            username: 'octas',
            icon_emoji: ':octopus:',
        });
        state.thread = ts;
        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: 'ここにお願いします！',
            thread_ts: ts,
            username: 'octas',
            icon_emoji: ':octopus:',
        });
    };
    const WaitForPlayers = async (message) => {
        if (message.text.match(/^先手$/)) {
            if (state.player === null) {
                // assign player
                state.player = message.user;
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: `先手<@${state.player}>`,
                    thread_ts: state.thread,
                    username: 'octas',
                    icon_emoji: ':octopus:'
                });
            }
            else {
                await Pardon(`先手はすでに<@${state.player}>に決まっています`);
            }
        }
        if (message.text.match(/^後手$/)) {
            if (state.opponent === null) {
                state.opponent = message.user;
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: `後手<@${state.opponent}>`,
                    thread_ts: state.thread,
                    username: 'octas',
                    icon_emoji: ':octopus:'
                });
            }
            else {
                await Pardon(`後手はすでに<@${state.opponent}>に決まっています`);
            }
        }
        if (state.player !== null && state.opponent !== null) {
            state.isGaming = true;
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: `*ゲーム開始* 方位を[N, E, W, S, NE, NW, SE, SW]から選択してください`,
                thread_ts: state.thread,
                username: 'octas',
                icon_emoji: ':octopus:'
            });
            // begin match!
            log.info('[OCTAS] matching accepted.');
        }
    };
    const ProcessHand = async (message) => {
        if (state.board.ended) {
            // いつのまにか終っている　強制終了
            processQueue.add(Halt);
            return;
        }
        const cmd2dir = new Map([
            ['N', 0],
            ['NE', 1],
            ['E', 2],
            ['SE', 3],
            ['S', 4],
            ['SW', 5],
            ['W', 6],
            ['NW', 7]
        ]);
        let response = "";
        if (state.board.activePlayer == 0) {
            if (message.user == state.player) {
                if (!cmd2dir.has(message.text)) {
                    await Pardon('方位は[N, E, W, S, NE, NW, SE, SW]から選択してください');
                    return;
                }
                const dir = cmd2dir.get(message.text);
                if (!state.board.getCurrentPoint().movableDirections.has(dir)) {
                    await Pardon('その方向へは進めません！');
                    return;
                }
                response = "先手: " + message.text;
                state.board.moveTo(dir);
                if (state.board.activePlayer == 0 && !state.board.ended)
                    response += " もう一回！";
            }
            else if (message.user == state.opponent) {
                await Pardon('今は先手番です！');
                return;
            }
        }
        else if (state.board.activePlayer == 1) {
            if (message.user == state.opponent) {
                if (!cmd2dir.has(message.text)) {
                    return;
                }
                const dir = cmd2dir.get(message.text);
                if (!state.board.getCurrentPoint().movableDirections.has(dir)) {
                    await Pardon('その方向へは進めません！');
                    return;
                }
                response = "後手: " + message.text;
                state.board.moveTo(dir);
                if (state.board.activePlayer == 1 && !state.board.ended)
                    response += " もう一回！";
            }
            else if (message.user == state.player) {
                await Pardon('今は後手番です！');
                return;
            }
        }
        const cloudinaryData = await uploadImage(state.paper);
        await slack.chat.update({
            channel: process.env.CHANNEL_SANDBOX,
            text: (0, common_tags_1.stripIndent) `
                Octas対人を始めるよ～
                スレッドに「先手」か「後手」と返信して参加しよう！
            `,
            ts: state.thread,
            attachments: [{
                    title: 'octas',
                    image_url: cloudinaryData.secure_url
                }],
        });
        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: response,
            thread_ts: state.thread,
            username: 'octas',
            icon_emoji: ':octopus:'
        });
        if (state.board.ended) {
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: `ゲームセット`,
                thread_ts: state.thread,
                username: 'octas',
                icon_emoji: ':octopus:'
            });
            if (state.board.winner == 0) {
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: `先手 <@${state.player}> の勝利:tada:`,
                    thread_ts: state.thread,
                    username: 'octas',
                    icon_emoji: ':octopus:',
                    reply_broadcast: true
                });
            }
            if (state.board.winner == 1) {
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: `後手 <@${state.opponent}> の勝利:tada:`,
                    thread_ts: state.thread,
                    username: 'octas',
                    icon_emoji: ':octopus:',
                    reply_broadcast: true
                });
            }
            log.info(`active: ${state.board.activePlayer}, winner: ${state.board.winner}`);
            (0, index_js_1.unlock)(state.player, 'octas-beginner');
            (0, index_js_1.unlock)(state.opponent, 'octas-beginner');
            if (state.player != state.opponent) {
                if (state.board.winner == 0) {
                    (0, index_js_1.increment)(state.player, 'octas-win');
                    if (state.board.getCurrentPoint() == null) {
                        // goal
                        if (state.board.activePlayer == 1) {
                            (0, index_js_1.unlock)(state.opponent, 'octas-owngoaler');
                        }
                    }
                    else {
                        // unable to move
                        (0, index_js_1.unlock)(state.player, 'octas-catch');
                    }
                }
                else {
                    (0, index_js_1.increment)(state.opponent, 'octas-win');
                    if (state.board.getCurrentPoint() == null) {
                        // goal
                        if (state.board.activePlayer == 0) {
                            (0, index_js_1.unlock)(state.player, 'octas-owngoaler');
                        }
                    }
                    else {
                        // unable to move
                        (0, index_js_1.unlock)(state.opponent, 'octas-catch');
                    }
                }
            }
            processQueue.add(Halt);
            return;
        }
    };
    eventClient.on('message', async (message) => {
        if (!message.text || message.subtype || message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (message.thread_ts && message.thread_ts == state.thread) {
            if (state.isGaming) {
                await processQueue.add(async () => ProcessHand(message));
            }
            else {
                await processQueue.add(async () => WaitForPlayers(message));
            }
        }
        if (message.text.match(/^octas$/i)) {
            if (state.isHolding) {
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: `中止(新規ゲームの開始)`,
                    thread_ts: state.thread,
                    username: 'octas',
                    icon_emoji: ':octopus:'
                });
                await processQueue.add(Halt);
            }
            if (message.thread_ts) {
                return;
            }
            await processQueue.add(Launch);
        }
    });
};
