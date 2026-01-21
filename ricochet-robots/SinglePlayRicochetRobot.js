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
const atequiz_1 = require("../atequiz");
const lodash_1 = require("lodash");
const cloudinary_1 = __importDefault(require("cloudinary"));
const image = __importStar(require("./image"));
const board = __importStar(require("./board"));
const achievements_1 = require("../achievements");
const assert_1 = __importDefault(require("assert"));
const common_tags_1 = require("common-tags");
class SinglePlayRicochetRobot extends atequiz_1.AteQuiz {
    startTime;
    endTime;
    boardData;
    answer;
    originalUser;
    constructor(slackClients, problem, boardData, answer, originalUser) {
        super(slackClients, problem, {
            username: 'hyperrobot',
            icon_emoji: ':robot_face:',
        });
        this.boardData = boardData;
        this.answer = answer;
        this.originalUser = originalUser;
    }
    static async init({ slackClients, channel, depth, size, numOfWalls, threadTs, originalUser }) {
        const [boardData, answer] = await board.getBoard({ depth, size, numOfWalls });
        const imageData = await image.upload(boardData);
        const quizText = `${answer.length}手詰めです`;
        const thumbnailUrl = cloudinary_1.default.v2.url(`${imageData.public_id}.jpg`, {
            private_cdn: false,
            secure: true,
            secure_distribution: 'res.cloudinary.com',
            background: 'white',
            width: 400,
            height: 400,
            crop: 'pad',
        });
        const singleRicochetRobot = new SinglePlayRicochetRobot(slackClients, {
            problemMessage: {
                channel,
                text: quizText,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: quizText,
                        },
                        accessory: {
                            type: 'image',
                            image_url: thumbnailUrl,
                            alt_text: 'ハイパーロボット',
                        },
                    },
                ],
                thread_ts: threadTs,
                reply_broadcast: true,
            },
            hintMessages: [],
            immediateMessage: {
                channel,
                text: 'このスレッドに回答してね！',
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: 'このスレッドに回答してね！',
                        },
                    },
                    {
                        type: 'image',
                        image_url: imageData.secure_url,
                        alt_text: 'ハイパーロボット',
                    },
                ],
            },
            solvedMessage: {
                channel,
                text: '',
            },
            unsolvedMessage: {
                channel,
                text: '',
            },
            correctAnswers: [],
        }, boardData, answer, originalUser);
        return singleRicochetRobot;
    }
    waitSecGen() {
        return Infinity;
    }
    start() {
        this.startTime = Date.now();
        return super.start();
    }
    postMessage(message) {
        return this.slack.chat.postMessage({
            ...message,
            channel: this.problem.problemMessage.channel,
            thread_ts: this.problem.problemMessage.thread_ts,
            username: 'hyperrobot',
            icon_emoji: ':robot_face:',
        });
    }
    async postNotSolvedMessage(board) {
        const message = '解けてませんね:thinking_face:';
        const imageData = await image.upload(board);
        await this.postMessage({
            text: message,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'plain_text',
                        text: '解けてませんね:thinking_face:',
                    },
                },
                {
                    type: 'image',
                    image_url: imageData.secure_url,
                    alt_text: '結果',
                },
            ],
        });
    }
    judge(answer) {
        if (board.iscommand(answer)) {
            const command = board.str2command(answer);
            if (!command.isMADE && command.moves.length > this.answer.length) {
                this.postMessage({
                    text: (0, common_tags_1.stripIndent) `
						この問題は${this.answer.length}手詰めだよ。その手は${command.moves.length}手かかってるよ:thinking_face:
						もし最短でなくてもよいなら、手順のあとに「まで」をつけてね。
					`,
                });
                return false;
            }
            const playerBoard = this.boardData.clone();
            playerBoard.movecommand(command.moves);
            if (playerBoard.iscleared()) {
                this.endTime = Date.now();
                return true;
            }
            this.postNotSolvedMessage(playerBoard);
            return false;
        }
        return false;
    }
    async solvedMessageGen(message) {
        const answer = message.text;
        (0, assert_1.default)(board.iscommand(answer), 'answer is not command');
        const command = board.str2command(answer);
        const playerBoard = this.boardData.clone();
        playerBoard.movecommand(command.moves);
        (0, assert_1.default)(playerBoard.iscleared(), 'playerBoard is not cleared');
        let comment = '正解です!:tada:';
        if (command.moves.length === this.answer.length) {
            comment += 'さらに最短勝利です!:waiwai:';
        }
        return {
            channel: this.problem.solvedMessage.channel,
            text: comment,
        };
    }
    async answerMessageGen(message) {
        const answer = message.text;
        (0, assert_1.default)(board.iscommand(answer), 'answer is not command');
        const command = board.str2command(answer);
        const playerBoard = this.boardData.clone();
        playerBoard.movecommand(command.moves);
        (0, assert_1.default)(playerBoard.iscleared(), 'playerBoard is not cleared');
        const blocks = [];
        const durationSeconds = (this.endTime - this.startTime) / 1000;
        let comment = '';
        if (command.moves.length < this.answer.length) {
            comment += 'というか:bug:ってますね...????? :hakatashi:に連絡してください。';
            await (0, achievements_1.unlock)(message.user, 'ricochet-robots-debugger');
        }
        const playerBoardImageData = await image.upload(playerBoard);
        if (comment.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: comment,
                },
            });
        }
        blocks.push({
            type: 'image',
            image_url: playerBoardImageData.secure_url,
            alt_text: 'プレイヤーの回答',
        });
        const botcomment = (command.moves.length > this.answer.length) ?
            `実は${this.answer.length}手でたどり着けるんです。\n${board.logstringfy(this.answer)}` :
            `僕の見つけた手順です。\n${board.logstringfy(this.answer)}`;
        const botBoard = this.boardData.clone();
        botBoard.movecommand(this.answer);
        const botBoardImageData = await image.upload(botBoard);
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: botcomment,
            },
        }, {
            type: 'image',
            image_url: botBoardImageData.url,
            alt_text: '想定回答',
        }, {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `経過時間: ${(0, lodash_1.round)(durationSeconds, 3)} 秒`,
            },
        });
        if (command.moves.length <= this.answer.length) {
            await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-shortest');
            if (this.answer.length >= 10) {
                await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-shortest-over10');
            }
            if (this.answer.length >= 15) {
                await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-shortest-over15');
            }
            if (this.answer.length >= 20) {
                await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-shortest-over20');
            }
        }
        await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear');
        if (this.answer.length >= 8 && command.moves.length <= this.answer.length) {
            if (durationSeconds <= this.answer.length * 10) {
                await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-in-10sec-per-move-over8');
            }
            if (durationSeconds <= this.answer.length * 5) {
                await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-in-5sec-per-move-over8');
            }
            if (durationSeconds <= this.answer.length * 1) {
                await (0, achievements_1.unlock)(message.user, 'ricochet-robots-clear-in-1sec-per-move-over8');
            }
        }
        return {
            channel: this.problem.solvedMessage.channel,
            text: comment,
            blocks,
        };
    }
}
exports.default = SinglePlayRicochetRobot;
