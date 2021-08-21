import type {SlackInterface} from '../lib/slack';
import logger from '../lib/logger';
import cloudinary from 'cloudinary';
import sharp from 'sharp';
import path from 'path';
import {stripIndent} from 'common-tags';
// @ts-expect-error
import Board from './lib/Board';
// @ts-expect-error
import BoardElement from './lib/Render';
import {JSDOM} from 'jsdom';
import Queue from 'p-queue';
import {increment, unlock} from '../achievements/index.js';

const applyCSS = (paper: any) => {
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

const uploadImage = async (paper: any) => {
    applyCSS(paper);
    const svg = Buffer.from(paper.toString());
    const png = await sharp(svg).png().toBuffer();
    const cloudinaryData: any = await new Promise((resolve, reject) => {
        cloudinary.v2.uploader
			.upload_stream({resource_type: 'image'}, (error, response) => {
				if (error) {
					reject(error);
				} else {
					resolve(response);
				}
			})
			.end(png);
    });
    return cloudinaryData;
};

interface State {
    thread: string,
    isHolding: boolean,
    isGaming: boolean,
    player: any,     // 先手
    opponent: any,   // 後手
    board: any,
    paper: any,
    element: any,
}

const processQueue = new Queue({concurrency: 1});

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    const state: State = {
        thread: null,
        isHolding: false,
        isGaming: false,
        player: null,
        opponent: null,
        board: null,
        paper: null,
        element: null,
    };

    const dom: any = await new Promise((resolve, reject) => {
        const resource: string = path.join(__dirname, "../node_modules/snapsvg/dist/snap.svg.js");
        const dom = new JSDOM(`
                <!DOCTYPE html><html>
                <body><div id="test"></div></body></html>
            `,
            {
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

    const Pardon = async (message: string) => {
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
        logger.info('[OCTAS] instance launched.');
        state.isHolding = true;
        state.board = new Board({width: 5, height: 5});
        state.paper = dom.window.Snap();
        state.element = new BoardElement(state.board, state.paper, dom.window.Snap);

        const cloudinaryData: any = await uploadImage(state.paper);
        const {ts}: any = await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: stripIndent`
                Octas対人を始めるよ～
                スレッドに「先手」か「後手」と返信して参加しよう！
            `,
            attachments: [{
                title: 'octas',
                image_url: cloudinaryData.secure_url
            }],
            username: 'octas',
            icon_emoji: ':octopus:',
            reply_broadcast: true,
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

    const WaitForPlayers = async (message: any) => {
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
            } else {
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
            } else {
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
            logger.info('[OCTAS] matching accepted.');
        }
    };

    const ProcessHand = async (message: any) => {
        if (state.board.ended) {
            // いつのまにか終っている　強制終了
            await processQueue.add(Halt);
            return;
        }
        const cmd2dir = new Map([
            ['N',  0],
            ['NE', 1],
            ['E',  2],
            ['SE', 3],
            ['S',  4],
            ['SW', 5],
            ['W',  6],
            ['NW', 7]]);
        let response: string = "";
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
            } else if (message.user == state.opponent) {
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
            } else if (message.user == state.player) {
                await Pardon('今は後手番です！');
                return;
            }
        }

        const cloudinaryData: any = await uploadImage(state.paper);
        await slack.chat.update({
            channel: process.env.CHANNEL_SANDBOX,
            text: stripIndent`
                Octas対人を始めるよ～
                スレッドに「先手」か「後手」と返信して参加しよう！
            `,
            ts: state.thread,
            attachments: [{
                title: 'octas',
                image_url: cloudinaryData.secure_url
            }],
            username: 'octas',
            icon_emoji: ':octopus:',
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
            logger.info(`active: ${state.board.activePlayer}, winner: ${state.board.winner}`);
            unlock(state.player, 'octas-beginner');
            unlock(state.opponent, 'octas-beginner');
            if (state.player != state.opponent) {
                if (state.board.winner == 0) {
                    increment(state.player, 'octas-win');
                    if (state.board.getCurrentPoint() == null) {
                        // goal
                        if (state.board.activePlayer == 1) {
                            unlock(state.opponent, 'octas-owngoaler');
                        }
                    } else {
                        // unable to move
                        unlock(state.player, 'octas-catch');
                    }
                } else {
                    increment(state.opponent, 'octas-win');
                    if (state.board.getCurrentPoint() == null) {
                        // goal
                        if (state.board.activePlayer == 0) {
                            unlock(state.player, 'octas-owngoaler');
                        }
                    } else {
                        // unable to move
                        unlock(state.opponent, 'octas-catch');
                    }
                }
            }
            await processQueue.add(Halt);
            return;
        }
    };

    rtm.on('message', async (message: any) => {
        if (!message.text || message.subtype || message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
        }

        if (message.thread_ts && message.thread_ts == state.thread) {
            if (state.isGaming) {
                await processQueue.add(async () => ProcessHand(message));
            } else {
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
}
