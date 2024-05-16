import assert from 'assert';
import type {ChatPostMessageArguments, ContextBlock, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import type {Collection, GuildMember, Snowflake, VoiceState} from 'discord.js';

const mutex = new Mutex();

interface RoomEvent {
	readonly type: 'join' | 'leave',
	readonly username: string,
	readonly timestamp: number,
}

export class Notifier {
	private slack: WebClient;

	private channelNotificationTimestamps: Map<string, string> = new Map();

	private roomEventPools: Map<string, RoomEvent[]> = new Map();

	constructor(slack: WebClient) {
		this.slack = slack;
	}

	private generateSummarizationText(events: RoomEvent[], roomName: string) {
		assert(events.length > 0);

		const users = new Set(events.map((event) => event.username));
		const eventTypeGroups = new Map<string, string[]>();

		for (const user of users) {
			const userEvents: ('join' | 'leave')[] = [];

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

			eventTypeGroups.get(eventText)!.push(user);
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

	private getMembersBlock(roomName: string, members: Collection<Snowflake, GuildMember>) {
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

	private async postMessage(
		{type, username, memberSize, roomId, roomName, roomMembers}: {
			type: 'join' | 'leave',
			username: string,
			memberSize: number,
			roomId: string,
			roomName: string,
			roomMembers: Collection<string, GuildMember>,
		},
	) {
		const now = Date.now();

		const roomEventPool = this.roomEventPools.get(roomId) ?? [];

		const newRoomEventPool = roomEventPool
			.concat([{type, username, timestamp: now}])
			.filter((event) => event.timestamp >= now - 3 * 60 * 1000);

		this.roomEventPools.set(roomId, newRoomEventPool);

		const text = `＊${username}＊が${roomName}${type === 'join' ? 'にログイン' : 'からログアウト'}しました`;
		const summarizationText = this.generateSummarizationText(newRoomEventPool, roomName);
		const countText = `現在のアクティブ人数 ${memberSize}人`;

		const getPostArguments = (channel: string, text: string) => ({
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

	async voiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
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
