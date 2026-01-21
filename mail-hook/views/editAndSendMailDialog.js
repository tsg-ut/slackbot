"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
exports.default = (replyId, mail, replyContent) => ({
    type: 'modal',
    callback_id: 'mail_hook_edit_and_send_mail_dialog',
    title: {
        text: 'メール編集',
        type: 'plain_text',
    },
    submit: {
        text: 'メールを送信する (取消不可)',
        type: 'plain_text',
    },
    blocks: [
        {
            type: 'section',
            text: {
                type: 'plain_text',
                text: mail.body.text,
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: '返信',
            },
            element: {
                type: 'plain_text_input',
                action_id: 'body',
                initial_value: replyContent,
                multiline: true,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: (0, common_tags_1.stripIndent) `
					FROM: \`${process.env.MAIL_HOOK_REPLY_FROM}\`
					REPLY-TO: \`${process.env.MAIL_HOOK_REPLY_FROM}\`
					TO: \`${mail.addresses.from}\`
					CC: \`${mail.addresses.cc}\`
					SUBJECT: \`Re: ${mail.subject}\`
				`,
            },
        },
    ],
    private_metadata: JSON.stringify({ replyId, mailId: mail.id }),
});
