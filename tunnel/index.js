"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const path_1 = __importDefault(require("path"));
const web_api_1 = require("@slack/web-api");
const emoji_data_ts_1 = require("emoji-data-ts");
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const lodash_1 = require("lodash");
const sql_template_strings_1 = __importDefault(require("sql-template-strings"));
const sqlite_1 = require("sqlite");
const sqlite3_1 = __importDefault(require("sqlite3"));
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const log = logger_1.default.child({ bot: 'tunnel' });
const messages = new Map();
let isTsgAllowing = true;
let isKmcAllowing = true;
const emojiData = new emoji_data_ts_1.EmojiData();
const getEmojiImageUrl = async (name, team) => {
    const emojiUrl = await (0, slackUtils_1.getEmoji)(name, team);
    if (emojiUrl !== undefined) {
        return emojiUrl;
    }
    const emoji = emojiData.getImageData(name);
    if (emoji) {
        return `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-64/${emoji.imageUrl}`;
    }
    return null;
};
// eslint-disable-next-line import/prefer-default-export
const server = ({ webClient: tsgSlack, eventClient }) => {
    const callback = async (fastify, opts, next) => {
        const db = await (0, sqlite_1.open)({
            filename: path_1.default.join(__dirname, '..', 'tokens.sqlite3'),
            driver: sqlite3_1.default.Database,
        });
        const kmcToken = await db.get((0, sql_template_strings_1.default) `SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`).catch(() => null);
        await db.close();
        const kmcSlack = kmcToken === undefined ? null : new web_api_1.WebClient(kmcToken.bot_access_token);
        const { team: tsgTeam } = await tsgSlack.team.info();
        fastify.post('/slash/tunnel', async (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            if (kmcToken === undefined) {
                res.code(500);
                return 'Slack token for KMC is not found';
            }
            if (req.body.team_id !== tsgTeam.id && req.body.team_id !== process.env.KMC_TEAM_ID) {
                res.code(400);
                return 'Bad Request';
            }
            const teamName = req.body.team_id === tsgTeam.id ? 'TSG' : 'KMC';
            const isAllowingSend = teamName === 'TSG' ? isTsgAllowing : isKmcAllowing;
            const isAllowingReceive = teamName === 'TSG' ? isKmcAllowing : isTsgAllowing;
            if (req.body.text.trim() === 'allow') {
                if (isAllowingSend) {
                    return '受信拒否は設定されてないよ';
                }
                if (teamName === 'TSG') {
                    isTsgAllowing = true;
                }
                else {
                    isKmcAllowing = true;
                }
                return '受信拒否を解除したよ:+1:';
            }
            if (req.body.text.trim() === 'deny') {
                if (!isAllowingSend) {
                    return '現在、受信拒否中だよ';
                }
                if (teamName === 'TSG') {
                    isTsgAllowing = false;
                }
                else {
                    isKmcAllowing = false;
                }
                return '受信拒否を設定したよ:cry:';
            }
            if (!isAllowingSend) {
                return '受信拒否設定中はメッセージを送れません:innocent:';
            }
            if (!isAllowingReceive) {
                return '受信拒否されているのでメッセージを送れません:cry:';
            }
            const iconUrl = await (0, slackUtils_1.getMemberIcon)(req.body.user_id, 192);
            const name = await (0, slackUtils_1.getMemberName)(req.body.user_id);
            const [{ ts: tsgTs }, { ts: kmcTs }] = await Promise.all([
                tsgSlack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: req.body.text,
                    username: `${name || req.body.user_name}@${teamName}`,
                    icon_url: iconUrl,
                    unfurl_links: true,
                }),
                kmcSlack.chat.postMessage({
                    channel: process.env.KMC_CHANNEL_SANDBOX,
                    text: req.body.text,
                    username: `${name || req.body.user_name}@${teamName}`,
                    icon_url: iconUrl,
                    unfurl_links: true,
                }),
            ]);
            messages.set(tsgTs, { team: 'KMC', ts: kmcTs, content: req.body.text });
            messages.set(kmcTs, { team: 'TSG', ts: tsgTs, content: req.body.text });
            return '';
        });
        const onReactionUpdated = async (event, updatedTeam) => {
            // update message of the other team
            const updatingMessageData = messages.get(event.item.ts);
            if (!updatingMessageData) {
                return;
            }
            const teamId = updatedTeam === 'TSG' ? tsgTeam.id : process.env.KMC_TEAM_ID;
            const reactions = await (0, slackUtils_1.getReactions)(event.item.channel, event.item.ts, teamId);
            const users = (0, lodash_1.uniq)((0, lodash_1.flatten)(Object.entries(reactions).map(([, reactedUsers]) => reactedUsers)));
            const userNames = await Promise.all(users.map(async (user) => {
                const name = await (0, slackUtils_1.getMemberName)(user);
                return [user, name ?? user];
            }));
            const userNameMap = new Map(userNames);
            const emojis = Object.entries(reactions).map(([name]) => name);
            const emojiUrls = await Promise.all(emojis.map(async (emoji) => {
                const url = await getEmojiImageUrl(emoji, teamId);
                return [emoji, url];
            }));
            const emojiUrlMap = new Map(emojiUrls);
            const blocks = [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        verbatim: true,
                        text: updatingMessageData.content,
                    },
                },
                ...Object.entries(reactions)
                    .map(([name, reactedUsers]) => (emojiUrlMap.has(name)
                    ? [
                        {
                            type: 'image',
                            image_url: emojiUrlMap.get(name),
                            alt_text: `:${name}: by ${reactedUsers.map((user) => userNameMap.get(user)).join(', ')}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `${reactedUsers.length}`,
                        },
                    ] : [
                    {
                        type: 'mrkdwn',
                        text: `:${name}: ${reactedUsers.length}`,
                    },
                ]))
                    .reduce(({ rows, cnt }, reaction) => {
                    if (cnt + reaction.length > 10) {
                        // next line
                        rows.push([reaction]);
                        return { rows, cnt: reaction.length };
                    }
                    rows[rows.length - 1].push(reaction);
                    return { rows, cnt: cnt + reaction.length };
                }, { rows: [[]], cnt: 0 }).rows
                    .map(lodash_1.flatten)
                    .map((elements) => ({
                    type: 'context',
                    elements,
                })),
            ];
            if (updatingMessageData.team === 'TSG') {
                await tsgSlack.chat.update({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: '',
                    ts: updatingMessageData.ts,
                    blocks: blocks.slice(0, 50),
                });
            }
            else {
                await kmcSlack.chat.update({
                    channel: process.env.KMC_CHANNEL_SANDBOX,
                    text: '',
                    ts: updatingMessageData.ts,
                    blocks: blocks.slice(0, 50),
                });
            }
        };
        for (const eventType of ['reaction_added', 'reaction_removed']) {
            eventClient.onAllTeam(eventType, (event, body) => {
                const team = body.team_id === process.env.TEAM_ID ? 'TSG'
                    : body.team_id === process.env.KMC_TEAM_ID ? 'KMC'
                        : null;
                if (!team) {
                    log.warn(`unknown team: ${body.team_id}`);
                    return;
                }
                onReactionUpdated(event, team);
            });
        }
        next();
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
