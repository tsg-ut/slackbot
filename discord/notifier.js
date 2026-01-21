"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notifier = void 0;
const assert_1 = __importDefault(require("assert"));
const async_mutex_1 = require("async-mutex");
const mutex = new async_mutex_1.Mutex();
class Notifier {
    slack;
    channelNotificationTimestamps = new Map();
    roomEventPools = new Map();
    constructor(slack) {
        this.slack = slack;
    }
    generateSummarizationText(events, roomName) {
        (0, assert_1.default)(events.length > 0);
        const users = new Set(events.map((event) => event.username));
        const eventTypeGroups = new Map();
        for (const user of users) {
            const userEvents = [];
            for (const event of events) {
                if (event.username === user) {
                    userEvents.push(event.type);
                }
            }
            const eventText = userEvents
                .map((event) => event === 'join' ? 'ログイン' : 'ログアウト')
                .join('して');
            if (!eventTypeGroups.has(eventText)) {
                eventTypeGroups.set(eventText, []);
            }
            eventTypeGroups.get(eventText).push(user);
        }
        return Array.from(eventTypeGroups.entries())
            .map(([eventType, users]) => {
            const usersText = users.map((user) => `＊${user}＊`).join(', ');
            if (eventType.startsWith('ログイン')) {
                return `${usersText}が${roomName}に${eventType}しました`;
            }
            return `${usersText}が${roomName}から${eventType}しました`;
        })
            .join('\n');
    }
    getMembersBlock(roomName, members) {
        return {
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `*[${roomName}]*`,
                },
                ...Array.from(members.values()).slice(0, 8)
                    .map((member) => ({
                    type: 'image',
                    image_url: member.user.displayAvatarURL({ extension: 'png', size: 64 }),
                    alt_text: member.displayName,
                })),
                {
                    type: 'plain_text',
                    emoji: true,
                    text: `${members.size} users`,
                },
            ],
        };
    }
    async postMessage({ type, username, memberSize, roomId, roomName, roomMembers }) {
        const now = Date.now();
        const roomEventPool = this.roomEventPools.get(roomId) ?? [];
        const newRoomEventPool = roomEventPool
            .concat([{ type, username, timestamp: now }])
            .filter((event) => event.timestamp >= now - 3 * 60 * 1000);
        this.roomEventPools.set(roomId, newRoomEventPool);
        const text = `＊${username}＊が${roomName}${type === 'join' ? 'にログイン' : 'からログアウト'}しました`;
        const summarizationText = this.generateSummarizationText(newRoomEventPool, roomName);
        const countText = `現在のアクティブ人数 ${memberSize}人`;
        const getPostArguments = (channel, text) => ({
            channel,
            username: 'Discord',
            icon_emoji: ':discord:',
            text: `${text}\n${countText}`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text,
                    },
                },
                this.getMembersBlock(roomName, roomMembers),
            ],
        });
        const [sandboxPostResponse] = await Promise.all([
            this.slack.chat.postMessage(getPostArguments(process.env.CHANNEL_SANDBOX, summarizationText)),
            this.slack.chat.postMessage(getPostArguments(process.env.CHANNEL_DISCORD, text)),
        ]);
        const timestamp = this.channelNotificationTimestamps.get(roomId);
        if (timestamp) {
            await this.slack.chat.delete({
                channel: process.env.CHANNEL_SANDBOX,
                ts: timestamp,
            });
        }
        this.channelNotificationTimestamps.set(roomId, sandboxPostResponse.ts);
    }
    async voiceStateUpdate(oldState, newState) {
        if (oldState.member.user.bot) {
            return;
        }
        const username = oldState.member.displayName;
        await mutex.runExclusive(async () => {
            if (oldState.channel?.id === newState.channel?.id) {
                return;
            }
            // leave
            if (oldState.channel !== null) {
                await this.postMessage({
                    type: 'leave',
                    username,
                    memberSize: oldState.channel.members.size,
                    roomId: oldState.channel.id,
                    roomName: oldState.channel.name,
                    roomMembers: oldState.channel.members,
                });
            }
            // join
            if (newState.channel !== null) {
                await this.postMessage({
                    type: 'join',
                    username,
                    memberSize: newState.channel.members.size,
                    roomId: newState.channel.id,
                    roomName: newState.channel.name,
                    roomMembers: newState.channel.members,
                });
            }
        });
    }
}
exports.Notifier = Notifier;
