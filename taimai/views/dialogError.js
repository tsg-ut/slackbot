"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (message) => ({
    type: "modal",
    title: {
        type: "plain_text",
        text: "エラー",
        emoji: true
    },
    "blocks": [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": message,
            }
        }
    ]
});
