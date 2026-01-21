"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const utils_1 = require("./utils");
const slackEventClient_1 = require("./slackEventClient");
const slackPatron_1 = require("./slackPatron");
const logger_1 = __importDefault(require("./logger"));
const log = logger_1.default.child({ bot: 'lib/slackCache' });
const TSG_TEAM_ID = process.env.TEAM_ID || 'T00000000';
class SlackCache {
    config;
    users = new Map();
    emojis = new Map();
    // Cache for message reactions. This property holds user IDs who reacted to a message,
    // ordered by the time of reaction.
    reactionsCache = new Map();
    loadUsersDeferred = new utils_1.Deferred();
    loadEmojisDeferred = new utils_1.Deferred();
    constructor(config) {
        this.config = config;
        const teamEventClient = new slackEventClient_1.TeamEventClient(this.config.eventClient, this.config.token.team_id);
        {
            // user cache
            teamEventClient.on('team_join', ({ user }) => {
                this.users.set(user.id, user);
            });
            teamEventClient.on('user_change', ({ user }) => {
                this.users.set(user.id, user);
            });
            this.config.webClient.users.list({ token: this.config.token.bot_access_token })
                .then(({ members }) => {
                for (const member of members) {
                    this.users.set(member.id, member);
                }
            })
                .then(() => this.loadUsersDeferred.resolve())
                .catch((err) => log.error(`SlackCache/users.list(${this.config.token.team_id}): ${err}`, err));
        }
        {
            // emoji cache
            teamEventClient.on('emoji_changed', async (event) => {
                if (event.subtype === 'add') {
                    this.emojis.set(event.name, event.value);
                }
            });
            this.config.webClient.emoji.list({ token: this.config.token.bot_access_token })
                .then(({ emoji: emojis }) => {
                for (const name in emojis) {
                    this.emojis.set(name, emojis[name]);
                }
            })
                .then(() => this.loadEmojisDeferred.resolve())
                .catch((err) => log.error(`SlackCache/emoji.list(${this.config.token.team_id}): ${err}`, err));
        }
        teamEventClient.on('message', (message) => {
            const key = `${message.channel}\0${message.ts}`;
            if (!this.reactionsCache.has(key)) {
                this.reactionsCache.set(key, Object.create(null));
            }
        });
        teamEventClient.on('reaction_added', (event) => (this.modifyReaction({
            type: 'add',
            channel: event.item.channel,
            ts: event.item.ts,
            reaction: event.reaction,
            user: event.user,
        })));
        teamEventClient.on('reaction_removed', (event) => (this.modifyReaction({
            type: 'remove',
            channel: event.item.channel,
            ts: event.item.ts,
            reaction: event.reaction,
            user: event.user,
        })));
    }
    async getUsers() {
        await this.loadUsersDeferred.promise;
        return Array.from(this.users.values());
    }
    async getUser(user) {
        await this.loadUsersDeferred.promise;
        return this.users.get(user);
    }
    async getEmoji(emoji) {
        await this.loadEmojisDeferred.promise;
        return this.emojis.get(emoji);
    }
    async getReactions(channel, ts) {
        const key = `${channel}\0${ts}`;
        {
            const reactions = this.reactionsCache.get(key);
            if (reactions) {
                return reactions;
            }
        }
        if (this.config.token.team_id !== TSG_TEAM_ID) {
            // conversationsHistoryはslack-patronを呼び出している都合上、
            // TSGチーム以外のチームでは利用できない。諦める。
            return {};
        }
        const data = await (0, slackPatron_1.conversationsHistory)({
            token: this.config.token.bot_access_token,
            channel: channel,
            latest: ts,
            limit: 1,
            inclusive: true,
        });
        {
            // race condition
            const reactions = this.reactionsCache.get(key);
            if (reactions) {
                return reactions;
            }
        }
        const remoteReactions = (0, lodash_1.get)(data, ['messages', 0, 'reactions'], []);
        const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => ([reaction.name, reaction.users ?? []])));
        this.reactionsCache.set(key, remoteReactionsObj);
        return remoteReactionsObj;
    }
    async modifyReaction({ channel, ts, reaction, user, type, }) {
        const key = `${channel}\0${ts}`;
        if (this.config.token.team_id !== TSG_TEAM_ID && !this.reactionsCache.has(key)) {
            // conversationsHistoryはslack-patronを呼び出している都合上
            // TSGチーム以外のチームでは利用できない。
            // 空のオブジェクトを初期状態として仮定する。
            this.reactionsCache.set(key, Object.create(null));
        }
        {
            const reactions = this.reactionsCache.get(key);
            if (reactions) {
                if (!{}.hasOwnProperty.call(reactions, reaction)) {
                    reactions[reaction] = [];
                }
                if (type === 'add') {
                    if (!reactions[reaction].includes(user)) {
                        reactions[reaction].push(user);
                    }
                }
                else {
                    const index = reactions[reaction].indexOf(user);
                    if (index !== -1) {
                        reactions[reaction].splice(index, 1);
                    }
                }
                return;
            }
        }
        const data = await (0, slackPatron_1.conversationsHistory)({
            token: this.config.token.bot_access_token,
            channel: channel,
            latest: ts,
            limit: 1,
            inclusive: true,
        });
        {
            // race condition
            const reactions = this.reactionsCache.get(key);
            if (reactions) {
                if (!{}.hasOwnProperty.call(reactions, reaction)) {
                    reactions[reaction] = [];
                }
                if (type === 'add') {
                    if (!reactions[reaction].includes(user)) {
                        reactions[reaction].push(user);
                    }
                }
                else {
                    const index = reactions[reaction].indexOf(user);
                    if (index !== -1) {
                        reactions[reaction].splice(index, 1);
                    }
                }
                return;
            }
        }
        const remoteReactions = (0, lodash_1.get)(data, ['messages', 0, 'reactions'], []);
        const remoteReactionsObj = Object.fromEntries(remoteReactions.map((reaction) => ([reaction.name, reaction.users ?? []])));
        this.reactionsCache.set(key, remoteReactionsObj);
        return;
    }
}
exports.default = SlackCache;
