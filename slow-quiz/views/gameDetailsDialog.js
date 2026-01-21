"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("../util");
const utils_1 = require("./lib/utils");
exports.default = (game) => ({
    type: 'modal',
    callback_id: 'slowquiz_answer_question_dialog',
    title: {
        text: '問題詳細',
        type: 'plain_text',
    },
    blocks: [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '出題者',
                emoji: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: (0, util_1.getUserMention)(game.author),
            },
        },
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '問題',
                emoji: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: game.question,
            },
        },
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '答え',
                emoji: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: game.answer,
            },
        },
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '読み',
                emoji: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: game.ruby,
            },
        },
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: 'ヒント',
                emoji: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: game.hint ?? 'なし',
            },
        },
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: 'ログ',
                emoji: true,
            },
        },
        ...(0, utils_1.getSubmissionsBlocks)(game, null),
    ],
});
