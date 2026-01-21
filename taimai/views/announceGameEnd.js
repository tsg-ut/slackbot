"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (game) => ({
    text: `正解: ${game.answer}`,
    blocks: [
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "セッション終了!"
                }
            ]
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*正解:* ${game.answer}`
            }
        }
    ]
});
