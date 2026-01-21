"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./lib/utils");
exports.default = (game, questionText, user) => ({
    type: 'modal',
    callback_id: 'slowquiz_answer_question_dialog',
    title: {
        text: 'クイズ解答',
        type: 'plain_text',
    },
    submit: {
        text: '解答する',
        type: 'plain_text',
    },
    notify_on_close: true,
    private_metadata: game.id,
    blocks: [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: 'あなたのこれまでの解答',
                emoji: true,
            },
        },
        ...(0, utils_1.getSubmissionsBlocks)(game, user),
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `＊Q. ${questionText}＊`,
            },
        },
        {
            type: 'input',
            optional: true,
            label: {
                type: 'plain_text',
                text: 'コメント',
            },
            dispatch_action: true,
            element: {
                type: 'plain_text_input',
                action_id: 'slowquiz_answer_dialog_submit_comment',
                placeholder: {
                    type: 'plain_text',
                    text: '解答に関するコメントがあれば入力してください',
                },
                dispatch_action_config: {
                    trigger_actions_on: ['on_enter_pressed'],
                },
            },
            hint: {
                type: 'plain_text',
                text: 'クイズ終了まで公開されません。Enterキーでコメントのみ送信可能',
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: '解答 (読みがなで入力)',
            },
            element: {
                type: 'plain_text_input',
                action_id: 'ruby',
            },
            ...(game.hint ? {
                hint: {
                    type: 'plain_text',
                    text: game.hint,
                },
            } : {}),
        },
    ],
});
