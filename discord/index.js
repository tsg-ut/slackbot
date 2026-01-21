"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const voice_1 = require("@discordjs/voice");
const discord_1 = __importDefault(require("../lib/discord"));
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const state_1 = __importDefault(require("../lib/state"));
const hayaoshi_1 = __importDefault(require("./hayaoshi"));
const notifier_1 = require("./notifier");
const tts_1 = __importDefault(require("./tts"));
const log = logger_1.default.child({ bot: 'discord' });
exports.default = async ({ webClient: slack, eventClient }) => {
    const state = await state_1.default.init('discord', {
        users: [],
        ttsDictionary: [{ key: 'https?:\\S*', value: 'URL省略' }],
        introQuizSongHistory: { urls: [] },
    });
    const slackNotifier = new notifier_1.Notifier(slack);
    const joinVoiceChannelFn = (channelId = process.env.DISCORD_SANDBOX_VOICE_CHANNEL_ID) => {
        const channel = discord_1.default.channels.cache.get(channelId);
        const connection = (0, voice_1.joinVoiceChannel)({
            channelId,
            guildId: channel.guild.id,
            // https://github.com/discordjs/voice/issues/166
            adapterCreator: channel.guild.voiceAdapterCreator,
        });
        return connection;
    };
    let hayaoshi = new hayaoshi_1.default(joinVoiceChannelFn, state.users, state.introQuizSongHistory);
    let tts = new tts_1.default(joinVoiceChannelFn, state.ttsDictionary);
    const attachDiscordHandlers = (hayaoshi, tts) => {
        hayaoshi.on('message', (message, channelId = process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) => {
            const discordTextSandbox = discord_1.default.channels.cache.get(channelId);
            return discordTextSandbox.send(message);
        });
        tts.on('message', (message, channelId = process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) => {
            const discordTextSandbox = discord_1.default.channels.cache.get(channelId);
            return discordTextSandbox.send(message);
        });
        hayaoshi.on('start-game', () => {
            log.info('[hayaoshi] start-game');
            tts.pause();
        });
        hayaoshi.on('end-game', () => {
            log.info('[hayaoshi] end-game');
            tts.unpause();
        });
    };
    attachDiscordHandlers(hayaoshi, tts);
    discord_1.default.on('messageCreate', async (message) => {
        if (message.content === 'tsgbot reload') {
            log.info('reloading hayaoshi and tts');
            tts.destroy();
            hayaoshi.destroy();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            hayaoshi = new hayaoshi_1.default(joinVoiceChannelFn, state.users, state.introQuizSongHistory);
            tts = new tts_1.default(joinVoiceChannelFn, state.ttsDictionary);
            attachDiscordHandlers(hayaoshi, tts);
            log.info('reloaded hayaoshi and tts');
            const discordTextSandbox = discord_1.default.channels.cache.get(process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID);
            await discordTextSandbox.send('リロードしました');
            return;
        }
        hayaoshi.onMessage(message);
        tts.onMessage(message);
    });
    discord_1.default.on('voiceStateUpdate', (oldState, newState) => {
        slackNotifier.voiceStateUpdate(oldState, newState);
    });
    eventClient.on('message', async (message) => {
        if (message.text && message.subtype === undefined && message.text.startsWith('@discord ')) {
            const text = message.text.replace(/^@discord/, '').trim();
            if (text === 'ユーザー一覧') {
                await slack.chat.postMessage({
                    username: 'discord',
                    icon_emoji: ':discord:',
                    channel: message.channel,
                    text: '',
                    attachments: await Promise.all(state.users.map(async (user) => ({
                        author_name: await (0, slackUtils_1.getMemberName)(user.slack),
                        author_icon: await (0, slackUtils_1.getMemberIcon)(user.slack),
                        text: `ID: ${user.discord}`,
                    }))),
                });
            }
            else if (text.match(/^\d+$/)) {
                const discordId = text;
                const slackId = message.user;
                if (discordId.length > 0) {
                    if (state.users.some(({ slack }) => slackId === slack)) {
                        state.users = state.users.map((user) => user.slack === slackId ? {
                            slack: slackId,
                            discord: discordId,
                        } : user);
                    }
                    else {
                        state.users.push({ slack: slackId, discord: discordId });
                    }
                    await slack.reactions.add({
                        name: '+1',
                        channel: message.channel,
                        timestamp: message.ts,
                    });
                }
            }
            else {
                await slack.chat.postMessage({
                    username: 'discord',
                    icon_emoji: ':discord:',
                    channel: message.channel,
                    text: ':wakarazu:',
                });
            }
        }
    });
};
