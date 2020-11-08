import type {ContextBlock} from '@slack/web-api';
import Discord, {TextChannel, Collection, Snowflake, GuildMember} from 'discord.js';
import type {SlackInterface} from '../lib/slack';
import {getMemberName} from '../lib/slackUtils';

const discord = new Discord.Client();

discord.login(process.env.TSGBOT_DISCORD_TOKEN);

const getMembersBlock = (roomName: string, members: Collection<Snowflake, GuildMember>) => (
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
						image_url: member.user.displayAvatarURL({format: 'png', size: 64}),
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

export default ({webClient: slack, rtmClient: rtm}: SlackInterface) => {
	rtm.on('message', async (message) => {
		const {channel, text, user, subtype, thread_ts} = message;
		if (!text || channel !== process.env.CHANNEL_SANDBOX || subtype !== undefined || thread_ts !== undefined) {
			return;
		}

		if (text.split('\n').length > 3 || text.length > 100) {
			return;
		}

		const nickname = await getMemberName(user);
		const discordSandbox2 = discord.channels.cache.get(process.env.DISCORD_SANDBOX_CHANNEL_ID) as TextChannel;

		discordSandbox2.send(`${nickname}: ${text}`);
	});

	discord.on('message', (message) => {
		if (!message.member.user.bot && message.channel.id === process.env.DISCORD_SANDBOX_CHANNEL_ID && message.content.length < 200) {
			slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: message.content,
				username: `${message.member.displayName}@Discord`,
				icon_url: message.member.user.displayAvatarURL({format: 'png', size: 128}),
			});
		}
	});

	discord.on('voiceStateUpdate', (oldState, newState) => {
		if (oldState.member.user.bot) {
			return;
		}

		const nick = oldState.member.displayName;

		// leave
		if (oldState.channel !== null && newState.channel === null) {
			const roomName = oldState.channel.name;
			const roomId = oldState.channel.id;
			const count = oldState.channel.members.size;
			slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'Discord',
				icon_emoji: ':discord:',
				text: `＊${nick}＊が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました\n現在のアクティブ人数 ${count}人`,
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `＊${nick}＊が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました`,
						},
					},
					getMembersBlock(roomName, oldState.channel.members),
				],
			});
		}

		// join
		if (newState.channel !== null && oldState.channel === null) {
			const roomName = newState.channel.name;
			const roomId = newState.channel.id;
			const count = newState.channel.members.size;
			slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'Discord',
				icon_emoji: ':discord:',
				text: `＊${nick}＊が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました\n現在のアクティブ人数 ${count}人`,
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `＊${nick}＊が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました`,
						},
					},
					getMembersBlock(roomName, newState.channel.members),
				],
			});
		}

		// move
		if (oldState.channel !== null && newState.channel !== null && oldState.channel.id !== newState.channel.id) {
			const newRoomName = newState.channel.name;
			const newRoomId = newState.channel.id;
			const oldRoomName = oldState.channel.name;
			const oldRoomId = oldState.channel.id;

			slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'Discord',
				icon_emoji: ':discord:',
				text: `＊${nick}＊が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `＊${nick}＊が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
						},
					},
					getMembersBlock(oldRoomName, oldState.channel.members),
					getMembersBlock(newRoomName, newState.channel.members),
				],
			});
		}
	});
};
