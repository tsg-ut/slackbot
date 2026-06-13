import type {SlackInterface} from '../lib/slack';
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
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import type {GenericMessageEvent} from '@slack/web-api';
import {extractMessage} from '../lib/slackUtils';

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
    thread: string | null,
    channel: string | null,
    isHolding: boolean,
    isGaming: boolean,
    player: any,     // 先手
    opponent: any,   // 後手
    board: any,
    paper: any,
    element: any,
}

const processQueue = new Queue({concurrency: 1});

class OctasBot extends ChannelLimitedBot {
    protected override readonly wakeWordRegex = /^octas$/i;
    protected override readonly username = 'octas';
    protected override readonly iconEmoji = ':octopus:';

    private state: State = {
        thread: null,
        channel: null,
        isHolding: false,
        isGaming: false,
        player: null,
        opponent: null,
        board: null,
        paper: null,
        element: null,
    };

    constructor(
        slackClients: SlackInterface,
        private readonly dom: any,
    ) {
        super(slackClients);
    }

    private halt() {
        this.state.thread = null;
        this.state.channel = null;
        this.state.isHolding = false;
        this.state.isGaming = false;
        this.state.player = null;
        this.state.opponent = null;
        this.state.board = null;
        this.state.paper = null;
        this.state.element = null;
    }

    private async launch(channel: string): Promise<string> {
        this.log.info('[OCTAS] instance launched.');
        this.state.isHolding = true;
        this.state.channel = channel;
        this.state.board = new Board({width: 5, height: 5});
        this.state.paper = this.dom.window.Snap();
        this.state.element = new BoardElement(this.state.board, this.state.paper, this.dom.window.Snap);

        const cloudinaryData: any = await uploadImage(this.state.paper);
        const {ts}: any = await this.postMessage({
            channel,
            text: stripIndent`
                Octas対人を始めるよ～
                スレッドに「先手」か「後手」と返信して参加しよう！
            `,
            attachments: [{
                title: 'octas',
                image_url: cloudinaryData.secure_url
            }],
        });
        this.state.thread = ts;

        await this.postMessage({
            channel,
            text: 'ここにお願いします！',
            thread_ts: ts,
        });

        return ts;
    }

    private async pardon(message: string) {
        await this.postMessage({
            channel: this.state.channel!,
            text: message,
            thread_ts: this.state.thread!,
        });
    }

    private async waitForPlayers(message: any) {
        if (message.text.match(/^先手$/)) {
            if (this.state.player === null) {
                // assign player
                this.state.player = message.user;

                await this.postMessage({
                    channel: this.state.channel!,
                    text: `先手<@${this.state.player}>`,
                    thread_ts: this.state.thread!,
                });
            } else {
                await this.pardon(`先手はすでに<@${this.state.player}>に決まっています`);
            }
        }
        if (message.text.match(/^後手$/)) {
            if (this.state.opponent === null) {
                this.state.opponent = message.user;

                await this.postMessage({
                    channel: this.state.channel!,
                    text: `後手<@${this.state.opponent}>`,
                    thread_ts: this.state.thread!,
                });
            } else {
                await this.pardon(`後手はすでに<@${this.state.opponent}>に決まっています`);
            }
        }
        if (this.state.player !== null && this.state.opponent !== null) {
            this.state.isGaming = true;
            await this.postMessage({
                channel: this.state.channel!,
                text: `*ゲーム開始* 方位を[N, E, W, S, NE, NW, SE, SW]から選択してください`,
                thread_ts: this.state.thread!,
            });

            // begin match!
            this.log.info('[OCTAS] matching accepted.');
        }
    }

    private async processHand(message: any) {
        if (this.state.board.ended) {
            // いつのまにか終っている　強制終了
            processQueue.add(() => this.halt());
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
        if (this.state.board.activePlayer == 0) {
            if (message.user == this.state.player) {
                if (!cmd2dir.has(message.text)) {
                    await this.pardon('方位は[N, E, W, S, NE, NW, SE, SW]から選択してください');
                    return;
                }
                const dir = cmd2dir.get(message.text);
                if (!this.state.board.getCurrentPoint().movableDirections.has(dir)) {
                    await this.pardon('その方向へは進めません！');
                    return;
                }
                response = "先手: " + message.text;
                this.state.board.moveTo(dir);
                if (this.state.board.activePlayer == 0 && !this.state.board.ended)
                    response += " もう一回！";
            } else if (message.user == this.state.opponent) {
                await this.pardon('今は先手番です！');
                return;
            }
        }
        else if (this.state.board.activePlayer == 1) {
            if (message.user == this.state.opponent) {
                if (!cmd2dir.has(message.text)) {
                    return;
                }
                const dir = cmd2dir.get(message.text);
                if (!this.state.board.getCurrentPoint().movableDirections.has(dir)) {
                    await this.pardon('その方向へは進めません！');
                    return;
                }
                response = "後手: " + message.text;
                this.state.board.moveTo(dir);
                if (this.state.board.activePlayer == 1 && !this.state.board.ended)
                    response += " もう一回！";
            } else if (message.user == this.state.player) {
                await this.pardon('今は後手番です！');
                return;
            }
        }

        const cloudinaryData: any = await uploadImage(this.state.paper);
        await this.slack.chat.update({
            channel: this.state.channel!,
            text: stripIndent`
                Octas対人を始めるよ～
                スレッドに「先手」か「後手」と返信して参加しよう！
            `,
            ts: this.state.thread!,
            attachments: [{
                title: 'octas',
                image_url: cloudinaryData.secure_url
            }],
        });

        await this.postMessage({
            channel: this.state.channel!,
            text: response,
            thread_ts: this.state.thread!,
        });

        if (this.state.board.ended) {
            await this.postMessage({
                channel: this.state.channel!,
                text: `ゲームセット`,
                thread_ts: this.state.thread!,
            });

            if (this.state.board.winner == 0) {
                await this.postMessage({
                    channel: this.state.channel!,
                    text: `先手 <@${this.state.player}> の勝利:tada:`,
                    thread_ts: this.state.thread!,
                    reply_broadcast: true
                });
            }
            if (this.state.board.winner == 1) {
                await this.postMessage({
                    channel: this.state.channel!,
                    text: `後手 <@${this.state.opponent}> の勝利:tada:`,
                    thread_ts: this.state.thread!,
                    reply_broadcast: true
                });
            }
            this.log.info(`active: ${this.state.board.activePlayer}, winner: ${this.state.board.winner}`);
            unlock(this.state.player, 'octas-beginner');
            unlock(this.state.opponent, 'octas-beginner');
            if (this.state.player != this.state.opponent) {
                if (this.state.board.winner == 0) {
                    increment(this.state.player, 'octas-win');
                    if (this.state.board.getCurrentPoint() == null) {
                        // goal
                        if (this.state.board.activePlayer == 1) {
                            unlock(this.state.opponent, 'octas-owngoaler');
                        }
                    } else {
                        // unable to move
                        unlock(this.state.player, 'octas-catch');
                    }
                } else {
                    increment(this.state.opponent, 'octas-win');
                    if (this.state.board.getCurrentPoint() == null) {
                        // goal
                        if (this.state.board.activePlayer == 0) {
                            unlock(this.state.player, 'octas-owngoaler');
                        }
                    } else {
                        // unable to move
                        unlock(this.state.opponent, 'octas-catch');
                    }
                }
            }
            await this.deleteProgressMessage(this.state.thread!);
            processQueue.add(() => this.halt());
            return;
        }
    }

    protected override async onMessageEvent(event: any) {
        await super.onMessageEvent(event);

        const message = extractMessage(event);
        if (message === null || !message.text || message.subtype) {
            return;
        }

        if (message.thread_ts && message.thread_ts === this.state.thread) {
            if (this.state.isGaming) {
                await processQueue.add(async () => this.processHand(message));
            } else {
                await processQueue.add(async () => this.waitForPlayers(message));
            }
        }
    }

    protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
        if (this.state.isHolding) {
            await this.postMessage({
                channel: this.state.channel!,
                text: '中止(新規ゲームの開始)',
                thread_ts: this.state.thread!,
            });
            processQueue.add(() => this.halt());
        }
        if (message.thread_ts) {
            return null;
        }
        const ts = await processQueue.add(() => this.launch(channel));
        return ts ?? null;
    }
}

export default async (slackClients: SlackInterface) => {
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

    return new OctasBot(slackClients, dom);
};
