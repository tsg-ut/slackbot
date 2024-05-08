import type {ChatPostMessageArguments, ContextBlock, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import type {Collection, GuildMember, Snowflake, VoiceState} from 'discord.js';

const mutex = new Mutex();

export class Notifier {
	slack: WebClient;

	channelNotificationTimestamps: Map<string, string> = new Map();

	constructor(slack: WebClient) {
		this.slack = slack;
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
		{type, username, memberSize, roomId, roomName, roomMembers}: {
			type: 'join' | 'leave',
			username: string,
			memberSize: number,
			roomId: string,
			roomName: string,
			roomMembers: Collection<string, GuildMember>,
		},
	) {
		const text = `＊${username}＊が${roomName}${type === 'join' ? 'にログイン' : 'からログアウト'}しました`;
		const countText = `現在のアクティブ人数 ${memberSize}人`;

		const postArguments: ChatPostMessageArguments = {
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
				this.getMembersBlock(roomName, roomMembers),
			],
		};

		const [sandboxPostResponse] = await Promise.all([
			this.slack.chat.postMessage(postArguments),
			this.slack.chat.postMessage({
				...postArguments,
				channel: process.env.CHANNEL_DISCORD,
			}),
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
