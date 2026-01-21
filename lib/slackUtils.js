"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlayground = exports.getAuthorityLabel = exports.extractMessage = exports.isGenericMessage = exports.mrkdwn = exports.plainText = exports.getEmoji = exports.getMemberIcon = exports.getMemberName = exports.getAllTSGMembers = exports.getReactions = void 0;
const web_api_1 = require("@slack/web-api");
const slack_1 = require("./slack");
const utils_1 = require("./utils");
const slackCache_1 = __importDefault(require("./slackCache"));
const os_1 = __importDefault(require("os"));
const slackCaches = new Map();
const initializedSlackCachesDeferred = new utils_1.Deferred();
// Immediately Invoked Function Expression
(async function initializedSlackCaches() {
    const tokens = await (0, slack_1.getTokens)();
    for (const token of tokens) {
        slackCaches.set(token.team_id, new slackCache_1.default({
            token,
            eventClient: slack_1.eventClient,
            webClient: new web_api_1.WebClient(),
        }));
    }
    initializedSlackCachesDeferred.resolve();
})();
const getReactions = async (channel, ts, team = process.env.TEAM_ID) => {
    await initializedSlackCachesDeferred.promise;
    const slackCache = slackCaches.get(team);
    if (!slackCache) {
        throw new Error(`Slack cache for team ${team} not found`);
    }
    return slackCache.getReactions(channel, ts);
};
exports.getReactions = getReactions;
const getAllTSGMembers = async () => {
    await initializedSlackCachesDeferred.promise;
    return await slackCaches.get(process.env.TEAM_ID).getUsers();
};
exports.getAllTSGMembers = getAllTSGMembers;
const getMemberName = async (user) => {
    await initializedSlackCachesDeferred.promise;
    // TODO: receive team_id and use it to choose slackCache
    let member = null;
    for (const caches of slackCaches.values()) {
        const found = await caches.getUser(user);
        if (found) {
            member = found;
            break;
        }
    }
    return member?.profile?.display_name || member?.profile?.real_name || member?.name;
};
exports.getMemberName = getMemberName;
const getMemberIcon = async (user, res = 24) => {
    await initializedSlackCachesDeferred.promise;
    // TODO: receive team_id and use it to choose slackCache
    let member = null;
    for (const caches of slackCaches.values()) {
        const found = await caches.getUser(user);
        if (found) {
            member = found;
            break;
        }
    }
    if (!member) {
        return undefined;
    }
    switch (res) {
        case 32:
            return member.profile?.image_32;
        case 48:
            return member.profile?.image_48;
        case 72:
            return member.profile?.image_72;
        case 192:
            return member.profile?.image_192;
        case 512:
            return member.profile?.image_512;
        default:
            return member.profile?.image_24;
    }
};
exports.getMemberIcon = getMemberIcon;
const getEmoji = async (name, team) => {
    await initializedSlackCachesDeferred.promise;
    return slackCaches.get(team)?.getEmoji(name);
};
exports.getEmoji = getEmoji;
const plainText = (text, emoji = true) => ({
    type: 'plain_text',
    text,
    emoji,
});
exports.plainText = plainText;
const mrkdwn = (text) => ({
    type: 'mrkdwn',
    text,
});
exports.mrkdwn = mrkdwn;
const isGenericMessage = (message) => (message.subtype === undefined);
exports.isGenericMessage = isGenericMessage;
const extractMessage = (message) => {
    if ((0, exports.isGenericMessage)(message)) {
        return message;
    }
    if (message.subtype === 'bot_message') {
        return message;
    }
    if (message.subtype === 'thread_broadcast') {
        // bot_id が抜けているので付与する。実際に Slack から来るイベントでは bot_id は存在することがある
        return message;
    }
    return null;
};
exports.extractMessage = extractMessage;
const getAuthorityLabel = () => {
    if (process.env.NODE_ENV === 'production') {
        return 'production';
    }
    if (process.env.GITHUB_USER && process.env.CODESPACE_NAME) {
        const abbreviatedCodespaceName = process.env.CODESPACE_NAME.split('-')[0] + '-…';
        return `Codespaces (@${process.env.GITHUB_USER}): ${abbreviatedCodespaceName}`;
    }
    const username = process.env.GITHUB_USER || process.env.USER || process.env.USERNAME || os_1.default.userInfo()?.username || 'unknown';
    const hostname = process.env.CODESPACE_NAME || os_1.default.hostname() || 'unknown';
    return `${username}@${hostname}`;
};
exports.getAuthorityLabel = getAuthorityLabel;
/**
 * 指定された Channel ID のチャンネルがゲームの起動を意図されたチャンネルかどうかを判定する
 */
const isPlayground = (channelId) => {
    const playgroundChannels = [
        process.env.CHANNEL_SANDBOX,
        process.env.CHANNEL_GAMES,
    ].filter(Boolean);
    return playgroundChannels.includes(channelId);
};
exports.isPlayground = isPlayground;
