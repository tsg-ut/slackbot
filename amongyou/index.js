"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const common_tags_1 = require("common-tags");
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const lodash_1 = require("lodash");
const moment_1 = __importDefault(require("moment"));
const slackUtils_1 = require("../lib/slackUtils");
const utils_1 = require("../lib/utils");
const CALLME = '@amongyou';
const AMONGABLE_CHECK_INTERVAL = 60 * 1000;
const timeList = () => {
    const isOver30 = (0, moment_1.default)().minutes() >= 30;
    const ret = (0, lodash_1.range)((0, moment_1.default)().hours(), (0, moment_1.default)().hours() + 24).map((n) => {
        const h = (n % 24).toString().padStart(2, '0');
        return [`${h}:00`, `${h}:30`];
    }).flat();
    if (isOver30) {
        return ret.splice(1);
    }
    return ret;
};
const numList = [
    '5', '8',
];
const printableDate = (date) => (0, moment_1.default)(date).format('MM/DD HH:mm');
const parseDate = (strDate) => {
    const date = (0, moment_1.default)(strDate, 'HH:mm');
    if ((0, moment_1.default)().diff(date, 'minutes') >= 30) {
        date.add(1, 'day');
    }
    return date.toDate();
};
const getModalBlocks = () => [
    {
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: '*参加可能時刻* と *希望最低人数* を選んでね! :among_us_red:',
        },
    },
    {
        type: 'actions',
        elements: [
            {
                type: 'static_select',
                placeholder: {
                    type: 'plain_text',
                    text: '開始',
                    emoji: true,
                },
                action_id: 'amongyou-start-time',
                options: getTimeOptions(),
            },
            {
                type: 'static_select',
                placeholder: {
                    type: 'plain_text',
                    text: '終了',
                    emoji: true,
                },
                action_id: 'amongyou-end-time',
                options: getTimeOptions(),
            },
            {
                type: 'static_select',
                placeholder: {
                    type: 'plain_text',
                    text: '希望最低人数',
                    emoji: true,
                },
                options: getNumOptions(),
                action_id: 'amongyou-num-people',
            },
        ],
    },
];
const getBlocks = () => [
    {
        type: 'actions',
        elements: [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    emoji: true,
                    text: '参加取り消し',
                },
                style: 'danger',
                value: 'amongus-cancel',
                action_id: 'amongyou-cancel',
            },
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    emoji: true,
                    text: 'JOIN!',
                },
                style: 'primary',
                value: 'amongus-join',
                action_id: 'amongyou-join',
            },
        ],
    },
];
class Among {
    eventClient;
    slack;
    slackInteractions;
    state;
    loadDeferred;
    // eslint-disable-next-line no-undef
    activeSchedular;
    constructor({ eventClient, slack, slackInteractions, }) {
        this.eventClient = eventClient;
        this.slack = slack;
        this.slackInteractions = slackInteractions;
        this.loadDeferred = new utils_1.Deferred();
        this.state = {
            users: [],
            tmpUsers: [],
            activeThread: null,
            activeChannel: null,
            timeApplicationStart: new Date(),
        };
    }
    async initialize() {
        if (this.loadDeferred.isResolved) {
            return this.loadDeferred.promise;
        }
        // restore state
        const statePath = path_1.default.resolve(__dirname, 'state.json');
        const exists = await fs_1.promises.access(statePath, fs_1.constants.F_OK)
            .then(() => true).catch(() => false);
        this.state = {
            users: [],
            tmpUsers: [],
            activeThread: null,
            activeChannel: null,
            timeApplicationStart: new Date(),
            ...(exists ? JSON.parse((await fs_1.promises.readFile(statePath)).toString()) : {}),
        };
        this.state.users = this.state.users.map((user) => ({
            ...user,
            timeStart: new Date(user.timeStart),
            timeEnd: new Date(user.timeEnd),
        }));
        this.state.tmpUsers = this.state.tmpUsers.map((user) => ({
            ...user,
            timeStart: new Date(user.timeStart),
            timeEnd: new Date(user.timeEnd),
        }));
        if (this.state.timeApplicationStart !== undefined) {
            this.state.timeApplicationStart = new Date(this.state.timeApplicationStart);
        }
        await fs_1.promises.writeFile(statePath, JSON.stringify(this.state));
        if (this.state.activeThread !== null) {
            this.activeSchedular = setInterval(() => this.checkAmongable(), AMONGABLE_CHECK_INTERVAL);
        }
        // register actions
        this.slackInteractions.action({
            type: 'button',
            actionId: 'amongyou-join',
            // eslint-disable-next-line no-unused-vars
        }, (payload, respond) => {
            if (this.state.activeChannel === null) {
                return;
            }
            this.slack.views.open({
                trigger_id: payload.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'amongyou-join-info',
                    submit: {
                        type: 'plain_text',
                        text: 'JOIN!',
                        emoji: true,
                    },
                    title: {
                        type: 'plain_text',
                        text: 'AmongYOU: 希望要件',
                    },
                    blocks: getModalBlocks(),
                },
            });
        });
        this.slackInteractions.viewSubmission('amongyou-join-info', async (payload) => {
            if (this.state.activeChannel === null) {
                return;
            }
            this.joinUser(payload.user.id);
            this.slack.chat.update({
                channel: this.state.activeChannel,
                ts: this.state.activeThread,
                text: '*現在の参加予定者だよ!*',
                attachments: await this.getStatAttachments(),
            });
            this.checkAmongable();
        });
        this.slackInteractions.action({
            type: 'button',
            actionId: 'amongyou-cancel',
            // eslint-disable-next-line no-unused-vars
        }, async (payload, respond) => {
            if (this.state.activeChannel === null) {
                return;
            }
            this.cancelUser(payload.user.id);
            this.slack.chat.update({
                channel: this.state.activeChannel,
                ts: this.state.activeThread,
                text: '*現在の参加予定者だよ!*',
                attachments: await this.getStatAttachments(),
            });
        });
        this.slackInteractions.action({
            type: 'static_select',
            actionId: 'amongyou-start-time',
            // eslint-disable-next-line no-unused-vars
        }, (payload, respond) => {
            if (this.state.activeChannel === null) {
                return;
            }
            this.setStartTime(payload.user.id, payload.actions[0].selected_option.text.text);
        });
        this.slackInteractions.action({
            type: 'static_select',
            actionId: 'amongyou-end-time',
            // eslint-disable-next-line no-unused-vars
        }, (payload, respond) => {
            if (this.state.activeChannel === null) {
                return;
            }
            this.setEndTime(payload.user.id, payload.actions[0].selected_option.text.text);
        });
        this.slackInteractions.action({
            type: 'static_select',
            actionId: 'amongyou-num-people',
            // eslint-disable-next-line no-unused-vars
        }, (payload, respond) => {
            if (this.state.activeChannel === null) {
                return;
            }
            this.setNumPeople(payload.user.id, payload.actions[0].selected_option.text.text);
        });
        // register message event receiver
        this.eventClient.on('message', async (message) => {
            // eslint-disable-next-line max-len
            if (!message.text || message.subtype || (message.channel !== process.env.CHANNEL_SANDBOX && message.channel !== process.env.CHANNEL_AMONGUS) || !message.text.startsWith(CALLME)) {
                return;
            }
            const args = message.text.split(' ').slice(1);
            switch (args[0]) {
                case ':wakarazu:':
                    await this.postMessageDefault(message, {
                        text: ':kowa:',
                    });
                default:
                    await this.postMessageDefault(message, {
                        text: ':wakarazu: :wakarazu: :wakarazu: :wakarazu: :wakarazu: :wakarazu:',
                    });
                    break;
            }
        });
        this.loadDeferred.resolve();
        return this.loadDeferred.promise;
    }
    async clearFile() {
        const statePath = path_1.default.resolve(__dirname, 'state.json');
        await fs_1.promises.writeFile(statePath, '');
    }
    async setState(object) {
        const statePath = path_1.default.resolve(__dirname, 'state.json');
        Object.assign(this.state, object);
        await fs_1.promises.writeFile(statePath, JSON.stringify(this.state));
    }
    async startAmongCandidate(channelid) {
        if (this.state.activeThread !== null) {
            await this.postMessageChannelDefault(channelid, {
                text: '既に募集は開始してるよ〜 :among_us_task:',
            });
            return;
        }
        await this.postMessageChannelDefault(channelid, {
            // eslint-disable-next-line max-len
            text: `*AmongUsの募集を開始するよ〜〜* :among_us_report: :among_us_report: ${channelid === process.env.CHANNEL_AMONGUS ? '<!channel>' : ''}`,
        });
        await this.postMessageChannelDefault(channelid, {
            text: '',
            blocks: getBlocks(),
        });
        const { ts } = await this.postStatMessage(channelid);
        this.state.activeThread = ts;
        this.state.activeChannel = channelid;
        this.state.timeApplicationStart = new Date();
        this.activeSchedular = setInterval(() => this.checkAmongable(), AMONGABLE_CHECK_INTERVAL);
        this.setState(this.state);
    }
    async clearAmongCandidate(channelid) {
        if (this.state.activeThread === null) {
            await this.postMessageChannelDefault(channelid, {
                text: '今は募集してないよ... :among_us_lime_dead:',
            });
            return;
        }
        clearInterval(this.activeSchedular);
        await this.clearFile();
        this.setState({
            users: [],
            tmpUsers: [],
            activeChannel: null,
            activeThread: null,
        });
        await this.postMessageChannelDefault(channelid, {
            text: '*AmongUsの募集を終了したよ〜* :among_us_cyan:',
        });
    }
    async getStatAttachments() {
        const attachments = [];
        for (const user of this.state.users) {
            attachments.push({
                color: '#ff66ff',
                author_name: await (0, slackUtils_1.getMemberName)(user.slackId),
                author_icon: await (0, slackUtils_1.getMemberIcon)(user.slackId),
                text: (0, common_tags_1.stripIndent) `
					${user.people}人   ${printableDate(user.timeStart)} ~ ${printableDate(user.timeEnd)}
				`,
            });
        }
        return attachments;
    }
    async postStatMessage(channelid) {
        const text = '*現在の参加予定者だよ!*';
        const attachments = await this.getStatAttachments();
        return this.postMessageChannelDefault(channelid, {
            text,
            attachments,
        });
    }
    postMessageChannelDefault(channelid, config = {}) {
        const postingConfig = {
            username: 'AmongYou',
            icon_emoji: ':amongus:',
            channel: channelid,
            text: '',
            ...config,
        };
        return this.slack.chat.postMessage(postingConfig);
    }
    postMessageDefault(receivedMessage, config = {}) {
        const postingConfig = {
            username: 'AmongYou',
            icon_emoji: ':amongus:',
            channel: receivedMessage.channel,
            text: '',
            ...config,
        };
        return this.slack.chat.postMessage(postingConfig);
    }
    addReactionDefault(receivedMessage, emoji) {
        return this.slack.reactions.add({
            name: emoji,
            channel: receivedMessage.channel,
            timestamp: receivedMessage.ts,
        });
    }
    postMessageThreadDefault(receivedMessage, config = {}) {
        const postingConfig = {
            username: 'AmongYou',
            icon_emoji: ':amongus:',
            channel: receivedMessage.channel,
            thread_ts: receivedMessage.ts,
            text: '',
            ...config,
        };
        return this.slack.chat.postMessage(postingConfig);
    }
    // eslint-disable-next-line require-await
    async setStartTime(slackid, start) {
        const date = parseDate(start);
        const targets = this.state.tmpUsers.filter((user) => user.slackId === slackid);
        if (targets.length === 1) {
            // regard time of previous 30mins as today (this means "I can join from now on")
            // it assumes the user choose the time as quickly as in few mins
            if (targets[0].timeEnd !== null && targets[0].timeEnd.getTime() - date.getTime() < 30 * 60 * 1000) {
                return;
            }
            this.setState({
                ...this.state,
                // eslint-disable-next-line max-len
                tmpUsers: this.state.tmpUsers.map((user) => user.slackId === slackid ? { ...user, timeStart: date } : user),
            });
        }
        else if (targets.length === 0) {
            this.state.tmpUsers.push({
                timeStart: date,
                timeEnd: null,
                slackId: slackid,
                people: null,
            });
            this.setState(this.state);
        }
    }
    // eslint-disable-next-line require-await
    async setEndTime(slackid, end) {
        const date = parseDate(end);
        const targets = this.state.tmpUsers.filter((user) => user.slackId === slackid);
        if (targets.length === 1) {
            // regard time of previous 30mins as today (this means "I can join from now on")
            // it assumes the user choose the time as quickly as in few mins
            if (targets[0].timeStart !== null && date.getTime() - targets[0].timeStart.getTime() < 30 * 60 * 1000) {
                return;
            }
            this.setState({
                ...this.state,
                tmpUsers: this.state.tmpUsers.map((user) => user.slackId === slackid ? { ...user, timeEnd: date } : user),
            });
        }
        else if (targets.length === 0) {
            this.state.tmpUsers.push({
                timeStart: null,
                timeEnd: date,
                slackId: slackid,
                people: null,
            });
            this.setState(this.state);
        }
    }
    // eslint-disable-next-line require-await
    async setNumPeople(slackid, numstr) {
        const num = Number(numstr);
        if (isNaN(num)) {
            return;
        }
        if (this.state.tmpUsers.some((user) => user.slackId === slackid)) {
            this.setState({
                ...this.state,
                tmpUsers: this.state.tmpUsers.map((user) => user.slackId === slackid ? { ...user, people: num } : user),
            });
        }
        else {
            this.state.tmpUsers.push({
                timeStart: null,
                timeEnd: null,
                slackId: slackid,
                people: num,
            });
            this.setState(this.state);
        }
    }
    checkValidity(slackid) {
        const targetix = this.state.tmpUsers.findIndex((user) => user.slackId === slackid);
        if (targetix === -1) {
            return false;
        }
        // eslint-disable-next-line max-len
        if (this.state.tmpUsers[targetix].people === null || this.state.tmpUsers[targetix].timeStart === null || this.state.tmpUsers[targetix].timeEnd === null) {
            return false;
        }
        return true;
    }
    // eslint-disable-next-line require-await
    async joinUser(slackid) {
        const targetix = this.state.tmpUsers.findIndex((user) => user.slackId === slackid);
        if (targetix === -1) {
            return;
        }
        // eslint-disable-next-line max-len
        if (this.state.tmpUsers[targetix].people === null || this.state.tmpUsers[targetix].timeStart === null || this.state.tmpUsers[targetix].timeEnd === null) {
            return;
        }
        if (this.state.users.some((user) => user.slackId === slackid)) {
            this.setState({
                ...this.state,
                tmpUsers: this.state.tmpUsers.filter((user) => user.slackId !== slackid),
                users: this.state.users.map((user) => user.slackId === slackid ? this.state.tmpUsers[targetix] : user),
            });
        }
        else {
            this.setState({
                ...this.state,
                tmpUsers: this.state.tmpUsers.filter((user) => user.slackId !== slackid),
                users: this.state.users.concat([this.state.tmpUsers[targetix]]),
            });
        }
    }
    cancelUser(slackid) {
        this.setState({
            ...this.state,
            users: this.state.users.filter((user) => user.slackId !== slackid),
        });
    }
    checkAmongableUsers() {
        const now = new Date();
        let amongableUsers = [];
        for (const user of this.state.users) {
            let timeStart = user.timeStart;
            let timeEnd = user.timeEnd;
            if (timeStart.getTime() === 0) {
                timeStart = new Date();
            }
            if (timeEnd.getTime() === 0) {
                timeEnd = (0, moment_1.default)().add(1, 'day').toDate();
            }
            if (now.getTime() >= timeStart.getTime() && now.getTime() <= timeEnd.getTime()) {
                amongableUsers.push(user);
            }
        }
        if (amongableUsers.length === 0) {
            return null;
        }
        let tmpcount = 0;
        let currentcount = amongableUsers.length;
        while (tmpcount !== currentcount) {
            tmpcount = amongableUsers.length;
            // eslint-disable-next-line no-loop-func
            amongableUsers = amongableUsers.filter((user) => user.people <= currentcount || user.people === null);
            currentcount = amongableUsers.length;
        }
        if (amongableUsers.length >= 1) {
            return amongableUsers;
        }
        return null;
    }
    checkAmongable() {
        const amongableUsers = this.checkAmongableUsers();
        if (amongableUsers !== null) {
            this.postMessageChannelDefault(this.state.activeChannel, {
                text: (0, common_tags_1.stripIndent) `
					*AmongUsが開催できるよ〜〜* (${amongableUsers.length}人) :among_us_report: :among_us_report:
					${amongableUsers.map((user) => `<@${user.slackId}>`).join(' ')}
				`,
            });
            // clear all
            this.clearAmongCandidate(this.state.activeChannel);
        }
        else {
            if (this.checkShouldFinishApplication()) {
                this.clearAmongCandidate(this.state.activeChannel);
            }
        }
    }
    checkShouldFinishApplication() {
        if (Date.now() - this.state.timeApplicationStart.getTime() < 12 * 60 * 60 * 1000) {
            return;
        }
        let shouldFinish = true;
        for (const user of this.state.users) {
            if (user.timeEnd.getTime() >= Date.now()) {
                shouldFinish = false;
                break;
            }
        }
        return shouldFinish;
    }
}
const getTimeOptions = () => {
    const options = [];
    timeList().forEach((t, ix) => {
        options.push({
            text: {
                type: 'plain_text',
                text: t,
                emoji: true,
            },
            value: `time-${ix}`,
        });
    });
    return options;
};
const getNumOptions = () => {
    const options = [];
    numList.forEach((t, ix) => {
        options.push({
            text: {
                type: 'plain_text',
                text: t,
                emoji: true,
            },
            value: `num-${ix}`,
        });
    });
    return options;
};
const server = ({ webClient: slack, eventClient, messageClient: slackInteractions }) => {
    const callback = async (fastify, opts, next) => {
        const among = new Among({ slack, eventClient, slackInteractions });
        await among.initialize();
        // eslint-disable-next-line require-await
        fastify.post('/slash/amongyou', async (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            res.code(200);
            const args = req.body.text.split(' ');
            if (args[0] === '') {
                args[0] = 'start';
            }
            switch (args[0]) {
                case 'start':
                    among.startAmongCandidate(req.body.channel_id);
                    return 'OK';
                case 'clear':
                    among.clearAmongCandidate(req.body.channel_id);
                    return 'OK';
                default:
                    return `Unknown Command: ${args[0]}`;
            }
        });
        next();
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
