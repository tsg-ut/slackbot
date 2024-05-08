import type {ContextBlock, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import type {Collection, GuildMember, Snowflake, VoiceState} from 'discord.js';

const mutex = new Mutex();

export class Notifier {
	slack: WebClient;

	lastNotificationTimestamp: string | null = null;

	roomNotifyCache = {
		lastUnixTime: 0, usernames: <string[]>[], ts: '', action: '',
	};

	notifyCacheLimit = 60000; // 1min

	constructor(slack: WebClient) {
		this.slack = slack;
	}

	usernameSummarizer(usernames: string[]) {
		if (usernames.length >= 3) {
			return `＊${usernames[0]}＊, ＊${usernames[1]}＊, ほか${usernames.length - 2}名`;
		} else if (usernames.length === 2) {
			return `＊${usernames[0]}＊, ＊${usernames[1]}＊`;
		} else if (usernames.length === 1) {
			return `＊${usernames[0]}＊`;
		}
		return '';
	}

	getMembersBlock(roomName: string, members: Collection<Snowflake, GuildMember>) {
		return (
			{
				type: 'context',
				elements: [
					{
						type: 'mrkdwn',
						text: `*[${roomName}]*`,
					},
					...Array.from(members.values()).slice(0, 8)
						.map((member) => (
							{
								type: 'image',
								image_url: member.user.displayAvatarURL({extension: 'png', size: 64}),
								alt_text: member.displayName,
							}
						)),
					{
						type: 'plain_text',
						emoji: true,
						text: `${members.size} users`,
					},
				],
			} as ContextBlock
		);
	}

	async postMessage(
		{text, count, rooms, ts}: {
			text: string,
			count: number,
			rooms: {
				name: string,
				members: Collection<string, GuildMember>,
			}[],
			ts: string,
		},
	) {
		const countText = count === null ? '' : `現在のアクティブ人数 ${count}人`;

		if (ts) {
			const result = await this.slack.chat.update({
				ts,
				channel: process.env.CHANNEL_SANDBOX,
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
					...rooms.map((room) => this.getMembersBlock(room.name, room.members)),
				],
			});
			return result;
		}

		const response = await this.slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
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
				...rooms.map((room) => this.getMembersBlock(room.name, room.members)),
			],
		});
		return response;
	}

	async voiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
		if (oldState.member.user.bot) {
			return;
		}

		const username = oldState.member.displayName;
		const eventTime = Date.now();

		await mutex.runExclusive(async () => {
			// leave
			if (oldState.channel !== null && newState.channel === null) {
				const roomName = oldState.channel.name;
				const roomId = oldState.channel.id;
				const count = oldState.channel.members.size;
				const actionName = `leave-${roomId}`;
				const update = this.roomNotifyCache.lastUnixTime + this.notifyCacheLimit > eventTime && this.roomNotifyCache.action === actionName;

				if (update) {
					this.roomNotifyCache.usernames.push(username);
				} else {
					this.roomNotifyCache.usernames = [username];
				}

				const response = await this.postMessage({
					text: `${this.usernameSummarizer(this.roomNotifyCache.usernames)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました`,
					count,
					rooms: [{name: roomName, members: oldState.channel.members}],
					ts: update ? this.roomNotifyCache.ts : null,
				});

				if (!update && response.ok) {
					this.roomNotifyCache.ts = response.ts;
				}

				this.roomNotifyCache.action = actionName;
				this.roomNotifyCache.lastUnixTime = eventTime;
			}

			// join
			if (newState.channel !== null && oldState.channel === null) {
				const roomName = newState.channel.name;
				const roomId = newState.channel.id;
				const count = newState.channel.members.size;
				const actionName = `join-${roomId}`;
				const update = this.roomNotifyCache.lastUnixTime + this.notifyCacheLimit > eventTime && this.roomNotifyCache.action === actionName;

				if (update) {
					this.roomNotifyCache.usernames.push(username);
				} else {
					this.roomNotifyCache.usernames = [username];
				}

				const response = await this.postMessage({
					text: `${this.usernameSummarizer(this.roomNotifyCache.usernames)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました`,
					count,
					rooms: [{name: roomName, members: newState.channel.members}],
					ts: update ? this.roomNotifyCache.ts : null,
				});

				if (!update && response.ok) {
					this.roomNotifyCache.ts = response.ts;
				}

				this.roomNotifyCache.action = actionName;
				this.roomNotifyCache.lastUnixTime = eventTime;
			}

			// move
			if (oldState.channel !== null && newState.channel !== null && oldState.channel.id !== newState.channel.id) {
				const newRoomName = newState.channel.name;
				const newRoomId = newState.channel.id;
				const oldRoomName = oldState.channel.name;
				const oldRoomId = oldState.channel.id;
				const actionName = `join-${oldRoomId}-${newRoomId}`;
				const update = this.roomNotifyCache.lastUnixTime + this.notifyCacheLimit > eventTime && this.roomNotifyCache.action === actionName;

				if (update) {
					this.roomNotifyCache.usernames.push(username);
				} else {
					this.roomNotifyCache.usernames = [username];
				}

				const response = await this.postMessage({
					text: `${this.usernameSummarizer(this.roomNotifyCache.usernames)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
					count: null,
					rooms: [
						{name: oldRoomName, members: oldState.channel.members},
						{name: newRoomName, members: newState.channel.members},
					],
					ts: update ? this.roomNotifyCache.ts : null,
				});

				if (!update && response.ok) {
					this.roomNotifyCache.ts = response.ts;
				}

				this.roomNotifyCache.action = actionName;
				this.roomNotifyCache.lastUnixTime = eventTime;
			}
		});
	}
}
