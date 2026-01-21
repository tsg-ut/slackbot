"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelLimitedBot = void 0;
const slackUtils_1 = require("./slackUtils");
const logger_1 = __importDefault(require("./logger"));
const utils_1 = require("./utils");
class ChannelLimitedBot {
    slackClients;
    slack;
    eventClient;
    messageClient;
    log = logger_1.default.child({ bot: this.constructor.name });
    wakeWordRegex = /.*/;
    allowedChannels = [process.env.CHANNEL_GAMES];
    username = 'slackbot';
    iconEmoji = ':robot_face:';
    progressMessageChannel = process.env.CHANNEL_SANDBOX;
    progressMessages = new Map(); // gameMessageTs -> Deferred<progressMessageTs>
    constructor(slackClients) {
        this.slackClients = slackClients;
        this.slack = slackClients.webClient;
        this.eventClient = slackClients.eventClient;
        this.messageClient = slackClients.messageClient;
        this.log.info(`Initialized ${this.constructor.name}`);
        this.log.info(`Allowed channels: ${this.allowedChannels.join(', ')}`);
        this.eventClient.on('message', this.onMessageEvent.bind(this));
    }
    async onMessageEvent(event) {
        const message = (0, slackUtils_1.extractMessage)(event);
        if (message === null ||
            !message.text ||
            !message.user ||
            message.bot_id !== undefined ||
            !(0, slackUtils_1.isGenericMessage)(message)) {
            return;
        }
        if (!this.wakeWordRegex.test(message.text)) {
            return;
        }
        const channel = this.allowedChannels.includes(message.channel) ? message.channel : this.allowedChannels[0];
        const responseTs = await this.onWakeWord(message, channel);
        const progressMessageDeferred = new utils_1.Deferred();
        if (responseTs !== null) {
            this.progressMessages.set(responseTs, progressMessageDeferred);
        }
        const isAllowedChannel = this.allowedChannels.includes(message.channel);
        if (responseTs === null) {
            if (!isAllowedChannel) {
                await this.slack.chat.postEphemeral({
                    channel: message.channel,
                    user: message.user,
                    text: 'このチャンネルではBOTを実行できません。',
                });
            }
        }
        else {
            const { permalink: responseUrl } = await this.slack.chat.getPermalink({
                channel,
                message_ts: responseTs,
            });
            this.log.debug(`Response permalink: ${responseUrl}`);
            if (!responseUrl) {
                this.log.error('Failed to get permalink for response message');
                progressMessageDeferred.reject(new Error('Failed to get permalink for response message'));
            }
            else {
                if (!isAllowedChannel) {
                    await this.slack.chat.postEphemeral({
                        channel: message.channel,
                        user: message.user,
                        text: `このチャンネルではBOTを実行できません。代わりに<${responseUrl}|こちら>で実行しました。`,
                    });
                }
                const progressMessageTs = await this.postProgressMessage(channel, responseTs, responseUrl);
                if (progressMessageTs) {
                    progressMessageDeferred.resolve(progressMessageTs);
                }
                else {
                    progressMessageDeferred.resolve(null);
                }
            }
        }
        if (!isAllowedChannel) {
            await this.slack.chat.delete({
                token: process.env.HAKATASHI_TOKEN,
                channel: event.channel,
                ts: event.ts,
            });
        }
    }
    async postProgressMessage(gameMessageChannel, gameMessageTs, gameMessageUrl) {
        if (this.progressMessageChannel === undefined ||
            this.progressMessageChannel === gameMessageChannel) {
            return undefined;
        }
        const gameMessageLink = gameMessageUrl ?? (await this.slack.chat.getPermalink({
            channel: gameMessageChannel,
            message_ts: gameMessageTs,
        })).permalink;
        if (gameMessageLink === undefined) {
            this.log.error('Failed to get permalink for game message');
            return undefined;
        }
        const progressMessage = await this.postMessage({
            channel: this.progressMessageChannel,
            text: `<${gameMessageLink}|進行中のゲーム>があります！`,
            unfurl_links: false,
            unfurl_media: false,
        });
        return progressMessage.ts;
    }
    postMessage(message) {
        return this.slack.chat.postMessage({
            username: this.username,
            icon_emoji: this.iconEmoji,
            ...message,
        });
    }
    async deleteProgressMessage(gameMessageTs) {
        if (this.progressMessageChannel === undefined) {
            return;
        }
        const progressMessageDeferred = this.progressMessages.get(gameMessageTs);
        if (progressMessageDeferred === undefined) {
            return;
        }
        this.progressMessages.delete(gameMessageTs);
        const progressMessageTs = await progressMessageDeferred.promise;
        if (progressMessageTs !== null) {
            await this.slack.chat.delete({
                channel: this.progressMessageChannel,
                ts: progressMessageTs,
            });
        }
    }
    async onWakeWord(event, targetChannel) {
        // Should be overridden
        return null;
    }
}
exports.ChannelLimitedBot = ChannelLimitedBot;
