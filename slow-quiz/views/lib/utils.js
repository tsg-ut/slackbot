"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubmissionsBlocks = void 0;
const lodash_1 = require("lodash");
const util_1 = require("../../util");
const formatSubmission = ({ days, type, user, answer }, showUser) => {
    if (type === 'wrong_answer') {
        return `${days}日目: ${showUser ? `${(0, util_1.getUserMention)(user)} ` : ''}＊解答「${answer}」＊ → 不正解`;
    }
    if (type === 'correct_answer') {
        return `${days}日目: ${showUser ? `${(0, util_1.getUserMention)(user)} ` : ''}＊解答「${answer}」＊ → 正解`;
    }
    return `${days}日目: ${showUser ? `${(0, util_1.getUserMention)(user)} ` : ''}${answer}`;
};
const getSubmissionsBlocks = (game, filterUserId) => {
    const userSubmissions = (0, lodash_1.sortBy)([
        ...game.wrongAnswers.map((answer) => ({ ...answer, type: 'wrong_answer' })),
        ...game.correctAnswers.map((answer) => ({ ...answer, type: 'correct_answer' })),
        ...game.comments.map((comment) => ({ ...comment, type: 'comment' })),
    ], (submission) => submission.date ?? 0);
    const blocks = [];
    let text = '';
    for (const submission of userSubmissions) {
        if (filterUserId && submission.user !== filterUserId) {
            continue;
        }
        if (Array.from(text).length >= 2000) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text,
                },
            });
            text = '';
        }
        text += formatSubmission(submission, filterUserId === null);
        text += '\n';
    }
    if (text !== '') {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text,
            },
        });
    }
    if (blocks.length === 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'まだ解答がありません',
            },
        });
    }
    return blocks;
};
exports.getSubmissionsBlocks = getSubmissionsBlocks;
