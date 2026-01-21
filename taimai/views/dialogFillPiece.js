"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const util_1 = require("../util");
exports.default = (game, focus) => ({
    type: "modal",
    callback_id: 'taimai_fill_piece',
    title: {
        type: "plain_text",
        text: "タイマイの問題を埋める",
        emoji: true
    },
    submit: {
        type: "plain_text",
        text: "確定する",
        emoji: true
    },
    "blocks": [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `以下の文章の${config_1.default.placeholders[focus]}にあてはまる内容を入力してください。`
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (0, util_1.formatOutlineUnfilled)(game.outline, game.pieces)
            }
        },
        {
            "type": "input",
            "element": {
                "type": "plain_text_input",
                "action_id": "taimai_fill_piece"
            },
            "label": {
                "type": "plain_text",
                "text": "空欄の内容",
                "emoji": true
            }
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "plain_text",
                    "text": `文章として成立するよう、前後と繋がるように注意してください。1文字以上${config_1.default.maxPieceChars}文字以下の制約があります。空欄が全て埋まると完成した文章が公開されます。`,
                    "emoji": true
                }
            ]
        }
    ]
});
