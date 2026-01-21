"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const util_1 = require("../util");
exports.default = (game) => ({
    text: `タイマイの問題が終了: ${game.answer || '投了'}`,
    blocks: [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "終了済みのタイマイ"
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*問題*: ${(0, util_1.formatOutlineFilled)(game.outline, game.pieces)}\n*正解:* ${game.answer || 'なし'}\n*回答者:* ${game.answer ? `<@${game.answerAuthor}>` : 'なし'}`,
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
        }
    ]
});
