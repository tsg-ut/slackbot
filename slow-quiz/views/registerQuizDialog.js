"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
exports.default = {
    type: 'modal',
    callback_id: 'slowquiz_register_quiz_dialog',
    title: {
        text: 'クイズ登録',
        type: 'plain_text',
    },
    submit: {
        text: '登録する',
        type: 'plain_text',
    },
    notify_on_close: true,
    blocks: [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: (0, common_tags_1.oneLineTrim) `
					出題の際には、<https://scrapbox.io/tsg/1日1文字クイズ|Scrapbox「1日1文字クイズ」>を参照し、
					それぞれのジャンルのレギュレーションに従った問題を出題してください。
				`,
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: '確認',
                emoji: true,
            },
            element: {
                type: 'checkboxes',
                options: [
                    {
                        text: {
                            type: 'plain_text',
                            text: '1日1文字クイズのレギュレーションを読み、確認しました',
                            emoji: true,
                        },
                        value: 'ok',
                    },
                ],
                action_id: 'confirm',
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: 'ジャンル',
            },
            element: {
                type: 'static_select',
                action_id: 'genre',
                placeholder: {
                    type: 'plain_text',
                    text: 'ジャンルを選んでください',
                    emoji: true,
                },
                options: Object.entries({
                    normal: '正統派',
                    strange: '変化球',
                    anything: 'なんでも',
                }).map(([id, label]) => ({
                    text: {
                        type: 'plain_text',
                        text: label,
                        emoji: true,
                    },
                    value: id,
                })),
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: '問題',
            },
            element: {
                type: 'plain_text_input',
                action_id: 'question',
                placeholder: {
                    type: 'plain_text',
                    text: '日本一高い山は何でしょう？',
                },
                multiline: true,
                max_length: 250,
            },
            hint: {
                type: 'plain_text',
                text: (0, common_tags_1.stripIndent) `
					基本的に90文字以内で入力してください。
					90文字以上の問題を出題したい場合は「/」で1日ごとに出題する量を指定してください。
					また、【】で囲った内容はスキップされます。
				`,
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: '答え',
            },
            element: {
                type: 'plain_text_input',
                action_id: 'answer',
                placeholder: {
                    type: 'plain_text',
                    text: '富士山',
                },
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: '読みがな',
            },
            element: {
                type: 'plain_text_input',
                action_id: 'ruby',
                placeholder: {
                    type: 'plain_text',
                    text: 'ふじさん',
                },
            },
            hint: {
                type: 'plain_text',
                text: (0, common_tags_1.stripIndent) `
					解答に使用します。ひらがな・カタカナ・英数字のみ使用することができます。
					「,」(半角カンマ)で区切ることで別解を指定することができます。
				`,
            },
        },
        {
            type: 'input',
            label: {
                type: 'plain_text',
                text: 'ヒント',
            },
            element: {
                type: 'plain_text_input',
                action_id: 'hint',
                placeholder: {
                    type: 'plain_text',
                    text: 'かな4文字・最も一般的な名称で解答',
                },
            },
            hint: {
                type: 'plain_text',
                text: '解答が一意に定まるようなヒントを入力してください',
            },
            optional: true,
        },
    ],
};
