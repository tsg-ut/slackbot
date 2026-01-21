"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("../util");
exports.default = (game) => ({
    text: `問題: ${(0, util_1.formatOutlineFilled)(game.outline, game.pieces)}`,
    blocks: [
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "セッション開始!"
                }
            ]
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*問題:* ${(0, util_1.formatOutlineFilled)(game.outline, game.pieces)}`
            }
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "スレッドでゲームを進行します。"
                }
            ]
        }
    ]
});
