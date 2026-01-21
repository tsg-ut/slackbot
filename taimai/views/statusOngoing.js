"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const util_1 = require("../util");
exports.default = (game) => ({
    text: `タイマイの問題が進行中: ${(0, util_1.formatOutlineFilled)(game.outline, game.pieces)}`,
    blocks: [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "タイマイが進行中!"
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (0, util_1.formatOutlineFilled)(game.outline, game.pieces),
            }
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": `出題者: <@${game.outlineAuthor}>${[...Array(game.pieces.length).keys()]
                        .filter(i => game.pieceAuthors[i])
                        .map(i => `, ${config_1.default.placeholders[i]}: <@${game.pieceAuthors[i]}>`)
                        .join('')}`
                }
            ]
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "plain_text",
                    "text": "スレッドで回答してください。",
                    "emoji": true
                }
            ]
        }
    ]
});
