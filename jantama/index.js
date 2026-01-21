"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const common_tags_1 = require("common-tags");
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const googleapis_1 = require("googleapis");
const lodash_1 = require("lodash");
const slackUtils_1 = require("../lib/slackUtils");
const state_1 = __importDefault(require("../lib/state"));
const utils_1 = require("../lib/utils");
const util_1 = require("./util");
const trueskillLoader = new utils_1.Loader(() => Promise.resolve().then(() => __importStar(require('ts-trueskill'))));
const BATTLE_LOG_ID = '1Ku67kvpt0oP6PZL7F_6AreQLiiuLq8k8P0qEDCcIqXI';
const getSlackNameOrNickname = (accountId, nickname, users) => {
    const user = users.find((user) => user.jantama === accountId);
    if (!user) {
        return nickname;
    }
    return (0, slackUtils_1.getMemberName)(user.slack);
};
const getSlackMentionOrNickname = (accountId, nickname, users) => {
    const user = users.find((user) => user.jantama === accountId);
    if (!user) {
        return nickname;
    }
    return `<@${user.slack}>`;
};
const getPlayerText = (player, users) => (getSlackMentionOrNickname(player.accountId.toString(), player.nickname, users));
const getResultText = (players, users) => {
    const lines = players.map((player, i) => {
        const scoreText = player.score.toLocaleString('en-US');
        const pointText = (player.point > 0 ? '+' : '') + (player.point / 1000).toLocaleString('en-US', { minimumFractionDigits: 1 });
        return `*#${i + 1}* ${getPlayerText(player, users)}: ${scoreText} (${pointText})`;
    });
    return lines.join('\n');
};
const getRatingChangeText = (ratingChanges, users) => {
    const lines = ratingChanges.map((ratingChange, i) => {
        const newRating = ratingChange.newRating.toFixed(2);
        const ratingDiff = ratingChange.newRating - ratingChange.oldRating;
        const ratingDiffText = ratingDiff.toFixed(2);
        return `*#${i + 1}* ${getPlayerText(ratingChange.player, users)}: ${newRating} (${ratingDiff > 0 ? '+' : ''}${ratingDiffText})`;
    });
    return lines.join('\n');
};
const getRecordedPaipuIds = async () => {
    const auth = new googleapis_1.google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
    const sheetsData = await new Promise((resolve, reject) => {
        sheets.spreadsheets.values.get({
            spreadsheetId: BATTLE_LOG_ID,
            range: 'log!B:B',
        }, (error, response) => {
            if (error) {
                reject(error);
            }
            else if (response.data.values) {
                resolve(response.data.values);
            }
            else {
                reject(new Error('values not found'));
            }
        });
    });
    return new Set(sheetsData.slice(1).map(([paipuId]) => paipuId));
};
const getSheetsData = async (spreadsheetId, range) => {
    const auth = new googleapis_1.google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
    const sheetsData = await new Promise((resolve, reject) => {
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        }, (error, response) => {
            if (error) {
                reject(error);
            }
            else if (response.data.values) {
                resolve(response.data.values);
            }
            else {
                reject(new Error('values not found'));
            }
        });
    });
    return sheetsData;
};
const generateRatingsFromHistory = async () => {
    const { rate, Rating } = await trueskillLoader.load();
    const sheetsData = await getSheetsData(BATTLE_LOG_ID, 'log!A:N');
    const sheetsDataSamma = await getSheetsData(BATTLE_LOG_ID, 'samma!A:K');
    const ratings = new Map();
    const nicknameMap = new Map();
    const battles = [];
    for (const cells of sheetsData.slice(1)) {
        const date = new Date(cells[0]).getTime();
        const users = [cells[3], cells[6], cells[9], cells[12]];
        const nicknames = [cells[2], cells[5], cells[8], cells[11]];
        for (const [user, nickname] of (0, lodash_1.zip)(users, nicknames)) {
            nicknameMap.set(user, nickname);
        }
        battles.push({ date, users });
    }
    for (const cells of sheetsDataSamma.slice(1)) {
        const date = new Date(cells[0]).getTime();
        const users = [cells[3], cells[6], cells[9]];
        const nicknames = [cells[2], cells[5], cells[8]];
        for (const [user, nickname] of (0, lodash_1.zip)(users, nicknames)) {
            nicknameMap.set(user, nickname);
        }
        battles.push({ date, users });
    }
    battles.sort((a, b) => a.date - b.date);
    for (const { users } of battles) {
        for (const user of users) {
            if (!ratings.has(user)) {
                ratings.set(user, new Rating());
            }
        }
        const newRatings = rate(users.map((user) => [ratings.get(user)]));
        for (const [user, [newRating]] of (0, lodash_1.zip)(users, newRatings)) {
            ratings.set(user, newRating);
        }
    }
    return { ratings, nicknames: nicknameMap };
};
const appendResultToHistory = async (paipuId, date, players) => {
    const auth = new googleapis_1.google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
    const targetRange = players.length === 4 ? 'log!A:N' : 'samma!A:K';
    await new Promise((resolve, reject) => {
        sheets.spreadsheets.values.append({
            spreadsheetId: BATTLE_LOG_ID,
            range: targetRange,
            insertDataOption: 'INSERT_ROWS',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                range: targetRange,
                majorDimension: 'ROWS',
                values: [[
                        date.toISOString(),
                        `=HYPERLINK("https://game.mahjongsoul.com/?paipu=${paipuId}", "${paipuId}")`,
                        ...players.flatMap((player) => [
                            player.nickname,
                            player.accountId.toString(),
                            player.score.toString(),
                        ]),
                    ]],
            },
        }, (error, response) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(response);
            }
        });
    });
};
const calculateNewRating = async (players) => {
    const { rate, Rating } = await trueskillLoader.load();
    // 麻雀ログの変更を適用するため、追加のたびに履歴を取得して最初から計算する
    const { ratings: oldRatings } = await generateRatingsFromHistory();
    for (const player of players) {
        if (!oldRatings.has(player.accountId.toString())) {
            oldRatings.set(player.accountId.toString(), new Rating());
        }
    }
    const newRatings = rate(players.map((player) => [oldRatings.get(player.accountId.toString())]));
    const ratingChanges = [];
    for (const [player, [newRating]] of (0, lodash_1.zip)(players, newRatings)) {
        const oldRating = oldRatings.get(player.accountId.toString());
        ratingChanges.push({
            player,
            oldRating: oldRating.mu - oldRating.sigma * 3,
            newRating: newRating.mu - newRating.sigma * 3,
        });
    }
    return ratingChanges;
};
const server = async ({ webClient: slack }) => {
    const state = await state_1.default.init('jantama', {
        users: [],
    });
    const callback = (fastify, opts, next) => {
        fastify.post('/slash/jantama', async (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            if (req.body.text === '') {
                return {
                    response_type: 'in_channel',
                    text: (0, common_tags_1.stripIndent) `
						:ichihime:使い方だにゃ！
						* \`/jantama\` - ヘルプを表示するにゃ！
						* \`/jantama ranking\` - TSG麻雀ランキングを表示するにゃ！
						* \`/jantama [牌譜URL]\` - 牌譜を記録するにゃ！
						* \`/jantama [ユーザーID]\` - Slack連携を設定するにゃ！
					`,
                };
            }
            if (req.body.text === 'ranking') {
                const { ratings, nicknames } = await generateRatingsFromHistory();
                // eslint-disable-next-line array-plural/array-plural
                const ranking = Array.from(ratings.entries()).map(([user, rating]) => ({
                    accountId: user,
                    nickname: nicknames.get(user),
                    rating: rating.mu - rating.sigma * 3,
                }));
                ranking.sort((a, b) => b.rating - a.rating);
                await slack.chat.postMessage({
                    channel: req.body.channel_id,
                    username: 'jantama',
                    icon_emoji: ':ichihime:',
                    text: 'TSG麻雀ランキングだにゃ！',
                    attachments: ranking.map((rank, i) => ({
                        title: `#${i + 1}: ${getSlackNameOrNickname(rank.accountId, rank.nickname, state.users)} (${rank.rating.toFixed(2)})`,
                    })),
                });
                return '';
            }
            if (req.body.text.match(/^\d+$/)) {
                const slackId = req.body.user_id;
                const jantamaId = req.body.text;
                if (state.users.some(({ slack }) => slackId === slack)) {
                    state.users = state.users.map((user) => user.slack === slackId ? {
                        slack: slackId,
                        jantama: jantamaId,
                    } : user);
                }
                else {
                    state.users.push({ slack: slackId, jantama: jantamaId });
                }
                return {
                    response_type: 'in_channel',
                    text: ':ichihime:連携を設定したにゃ！',
                };
            }
            const paipuId = (0, util_1.extractMajsoulId)(req.body.text);
            if (paipuId === null) {
                return ':ichihime:牌譜URLが見つからなかったにゃ⋯⋯';
            }
            const recordedPaipuIds = await getRecordedPaipuIds();
            if (recordedPaipuIds.has(paipuId)) {
                return ':ichihime:その牌譜はすでに登録されているにゃ！';
            }
            (async () => {
                const { players, date } = await (0, util_1.getMajsoulResult)(paipuId);
                if (players === null) {
                    await slack.chat.postMessage({
                        channel: req.body.channel_id,
                        username: 'jantama',
                        icon_emoji: ':ichihime:',
                        text: ':ichihime:牌譜が見つからなかったにゃ⋯⋯',
                    });
                    return;
                }
                const ratingChanges = await calculateNewRating(players);
                await appendResultToHistory(paipuId, date, players);
                await slack.chat.postMessage({
                    channel: req.body.channel_id,
                    username: 'jantama',
                    icon_emoji: ':ichihime:',
                    text: '',
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `対戦結果を記録したにゃ！\n牌譜ID: <https://game.mahjongsoul.com/?paipu=${paipuId}|${paipuId}>`,
                            },
                        },
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: '対戦結果',
                                emoji: true,
                            },
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: getResultText(players, state.users),
                            },
                        },
                        {
                            type: 'divider',
                        },
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: 'TSG麻雀レート',
                                emoji: true,
                            },
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: getRatingChangeText(ratingChanges, state.users),
                            },
                        },
                        {
                            type: 'divider',
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `Slackアカウントを登録するには、<https://docs.google.com/spreadsheets/d/${BATTLE_LOG_ID}|対戦ログ>を確認して \`/jantama [自分のID]\` と入力するにゃ！`,
                            },
                        },
                    ],
                });
            })();
            return ':ichihime:登録を受け付けたにゃ！処理が終わるまでしばらく待つにゃ！';
        });
        next();
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
