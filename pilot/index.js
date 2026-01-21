"use strict";
/* eslint-disable import/no-named-as-default-member */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const mustache_1 = __importDefault(require("mustache"));
const yaml_1 = __importDefault(require("yaml"));
const zod_1 = require("zod");
const logger_1 = __importDefault(require("../lib/logger"));
const state_1 = __importDefault(require("../lib/state"));
const utils_1 = require("../lib/utils");
const log = logger_1.default.child({ bot: 'pilot' });
const Config = zod_1.z.object({
    matches: zod_1.z.array(zod_1.z.object({
        channel: zod_1.z.string().nonempty(),
        description: zod_1.z.string().nonempty(),
        words: zod_1.z.array(zod_1.z.string().nonempty()).nonempty(),
    })).nonempty(),
});
const scrapboxGet = (url) => (axios_1.default.get(url, {
    headers: {
        Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`,
    },
}));
const configYamlUrl = 'https://scrapbox.io/api/code/tsg/pilot/config.yml';
const configLoader = new utils_1.Loader(async () => {
    const { data } = await scrapboxGet(configYamlUrl);
    return Config.parse(yaml_1.default.parse(data));
});
const templateUrl = 'https://scrapbox.io/api/code/tsg/pilot/template.mustache';
const templateLoader = new utils_1.Loader(async () => {
    const { data } = await scrapboxGet(templateUrl);
    return data;
});
const templateNomatchUrl = 'https://scrapbox.io/api/code/tsg/pilot/template-nomatch.mustache';
const templateNomatchLoader = new utils_1.Loader(async () => {
    const { data } = await scrapboxGet(templateNomatchUrl);
    return data;
});
exports.default = async ({ eventClient, webClient: slack, messageClient }) => {
    const state = await state_1.default.init('pilot', {
        messages: {},
    });
    const postPilotMessage = (text, threadTs, blocks = undefined) => slack.chat.postMessage({
        channel: process.env.CHANNEL_SELF_INTRODUCTION,
        text,
        blocks,
        link_names: true,
        icon_emoji: ':tsg:',
        username: 'TSG',
        thread_ts: threadTs,
    });
    const updatePilotMessage = (text, ts, threadTs, blocks = undefined) => slack.chat.update({
        channel: process.env.CHANNEL_SELF_INTRODUCTION,
        ts,
        text,
        blocks,
        link_names: true,
    });
    const getTextAndBlocks = async (text, user, ts, invitationCompleted) => {
        const { channels } = await slack.conversations.list();
        const config = await configLoader.load();
        const normalizedText = text.toLowerCase();
        const matches = config.matches.filter((match) => (match.words.some((word) => (normalizedText.includes(word.toLowerCase())))));
        if (matches.length === 0) {
            const template = await templateNomatchLoader.load();
            const output = mustache_1.default.render(template, { user });
            return {
                text: output,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: output,
                        },
                    },
                ],
            };
        }
        const template = await templateLoader.load();
        const [rawHeader = '', rawFooter = ''] = template.split('{{actions}}');
        const header = rawHeader.trim();
        const footer = rawFooter.trim();
        const matchedChannels = [];
        const recommendations = matches
            .map((match) => {
            const matchChannel = channels.find(({ name }) => match.channel === name);
            if (!matchChannel) {
                return `● #${match.channel}: ${match.description}`;
            }
            matchedChannels.push({
                id: matchChannel.id,
                name: match.channel,
                description: match.description,
            });
            return `● <#${matchChannel.id}|${match.channel}>: ${match.description}`;
        })
            .join('\n');
        const headerText = mustache_1.default.render(header, { user, recommendations });
        const footerText = mustache_1.default.render(footer, { user, recommendations });
        return {
            text: headerText + footerText,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: headerText,
                    },
                },
                invitationCompleted ? {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '招待しました😀',
                    },
                } : {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'おすすめされたチャンネルに一括で入室する',
                                emoji: true,
                            },
                            value: JSON.stringify({
                                channelIds: matchedChannels.map(({ id }) => id),
                                userId: user,
                                originalTs: ts,
                            }),
                            action_id: 'pilot_join_channel',
                            style: 'primary',
                        },
                    ],
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: footerText,
                    },
                },
            ],
        };
    };
    eventClient.on('message', async ({ channel, text, thread_ts, bot_id, user, ts, subtype, message: editedMessage, }) => {
        if (subtype === 'message_changed') {
            if (!editedMessage.text ||
                !editedMessage.user ||
                channel !== process.env.CHANNEL_SELF_INTRODUCTION ||
                editedMessage.thread_ts !== editedMessage.ts ||
                editedMessage.bot_id !== undefined) {
                return;
            }
            const invitationCompleted = state.messages[editedMessage.ts]?.invitationCompleted ?? false;
            const messageTs = state.messages[editedMessage.ts]?.messageTs;
            const { text: outputText, blocks, } = await getTextAndBlocks(editedMessage.text, editedMessage.user, editedMessage.ts, invitationCompleted);
            if (messageTs) {
                await updatePilotMessage(outputText, messageTs, editedMessage.ts, blocks);
            }
            else {
                await postPilotMessage(outputText, editedMessage.ts, blocks);
            }
            // eslint-disable-next-line require-atomic-updates
            state.messages[editedMessage.ts] = {
                text: editedMessage.text,
                invitationCompleted,
                messageTs,
            };
            return;
        }
        if (!text ||
            !user ||
            channel !== process.env.CHANNEL_SELF_INTRODUCTION ||
            thread_ts !== undefined ||
            bot_id !== undefined ||
            subtype === 'channel_join' ||
            subtype === 'channel_leave') {
            return;
        }
        const { text: outputText, blocks } = await getTextAndBlocks(text, user, ts, false);
        const message = await postPilotMessage(outputText, ts, blocks);
        state.messages[ts] = {
            text,
            invitationCompleted: false,
            messageTs: message.ts,
        };
    });
    const processInvitation = async ({ channelIds, userId, originalTs, invokedUser, ts, }) => {
        if (userId !== invokedUser) {
            return;
        }
        const invitationCompleted = state.messages[originalTs]?.invitationCompleted ?? false;
        if (invitationCompleted) {
            log.warn('invitation already completed');
            return;
        }
        for (const channelId of channelIds) {
            await slack.conversations.invite({
                channel: channelId,
                users: userId,
                token: process.env.HAKATASHI_TOKEN,
            }).catch((error) => {
                log.error(`Invitation failed for channel ${channelId}`);
                log.error(error);
            });
        }
        const messageTs = state.messages[originalTs]?.messageTs;
        const { text: outputText, blocks, } = await getTextAndBlocks(state.messages[originalTs]?.text, userId, ts, true);
        await updatePilotMessage(outputText, messageTs, ts, blocks);
        // eslint-disable-next-line require-atomic-updates
        state.messages[originalTs] = {
            ...state.messages[originalTs],
            invitationCompleted: true,
            messageTs,
        };
    };
    messageClient.action({
        type: 'button',
        actionId: 'pilot_join_channel',
    }, (payload) => {
        const data = JSON.parse(payload?.actions?.[0]?.value ?? '{}');
        processInvitation({
            ...data,
            invokedUser: payload?.user?.id,
            ts: payload?.message?.ts,
        });
    });
};
