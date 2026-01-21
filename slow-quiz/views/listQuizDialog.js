"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
exports.default = (games) => ({
    type: 'modal',
    callback_id: 'slowquiz_answer_question_dialog',
    title: {
        text: 'あなたが登録した問題一覧',
        type: 'plain_text',
    },
    notify_on_close: true,
    blocks: games.map((game) => ({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: (0, common_tags_1.stripIndent) `
					問題: ${game.question}
					解答: ${game.answer}
					読み: ${game.ruby}
					ヒント: ${game.hint ?? ''}
				`,
        },
        accessory: {
            type: 'button',
            text: {
                type: 'plain_text',
                text: '削除する',
                emoji: true,
            },
            style: 'danger',
            value: game.id,
            action_id: 'slowquiz_delete_quiz_button',
        },
    })),
});
