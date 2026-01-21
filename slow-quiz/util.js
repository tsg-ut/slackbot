"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserName = exports.getUserIcon = exports.getUserMention = void 0;
const slackUtils_1 = require("../lib/slackUtils");
const getUserMention = (userId) => {
    if (userId.startsWith('bot:')) {
        const botId = userId.replace(/^bot:/, '');
        return `＊${botId}＊`;
    }
    return `<@${userId}>`;
};
exports.getUserMention = getUserMention;
const getUserIcon = (userId) => {
    if (userId.startsWith('bot:')) {
        return (0, slackUtils_1.getEmoji)('chatgpt', process.env.TEAM_ID);
    }
    return (0, slackUtils_1.getMemberIcon)(userId);
};
exports.getUserIcon = getUserIcon;
const getUserName = (userId) => {
    if (userId.startsWith('bot:')) {
        const botId = userId.replace(/^bot:/, '');
        return botId;
    }
    return (0, slackUtils_1.getMemberName)(userId);
};
exports.getUserName = getUserName;
