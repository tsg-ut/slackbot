import type {ContextBlock, WebAPICallResult} from '@slack/web-api';
import Discord, {TextChannel, Collection, Snowflake, GuildMember, VoiceChannel} from 'discord.js';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import State from '../lib/state';
import Hayaoshi from './hayaoshi';
import TTS from './tts';

interface ChatPostMessageResult extends WebAPICallResult {
	ts: string;
}

interface StateObj {
	users: {discord: string, slack: string}[],
	ttsDictionary: {key: string, value: string}[],
}

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

export default async ({webClient: slack, rtmClient: rtm}: SlackInterface) => {
	const state = await State.init<StateObj>('discord', {
		users: [],
		ttsDictionary: [{key: 'https?:.*', value: 'URL省略'}],
	});

	const joinVoiceChannelFn = (channelId: string = process.env.DISCORD_SANDBOX_VOICE_CHANNEL_ID) => {
		const discordSandbox = discord.channels.cache.get(channelId) as VoiceChannel;
		return discordSandbox.join();
	};
	const roomNotifyCache = {
		lastUnixTime: 0, nicks: <string[]>[], ts: '', action: '',
	};
	const notifyCacheLimit = 60000; // 1min
	const nickSummarizer = (nicks: string[]) => {
		if (nicks.length >= 3) {
			return `＊${nicks[0]}＊, ＊${nicks[1]}＊, ほか${nicks.length - 2}名`;
		} else if (nicks.length === 2) {
			return `＊${nicks[0]}＊, ＊${nicks[1]}＊`;
		} else if (nicks.length === 1) {
			return `＊${nicks[0]}＊`;
		}
		return '';
	};

	const hayaoshi = new Hayaoshi(joinVoiceChannelFn, state.users);
	const tts = new TTS(joinVoiceChannelFn, state.ttsDictionary);

	hayaoshi.on('message', (message: string, channelId: string = process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) => {
		const discordTextSandbox = discord.channels.cache.get(channelId) as TextChannel;
		return discordTextSandbox.send(message);
	});

	tts.on('message', (message: string, channelId: string = process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) => {
		const discordTextSandbox = discord.channels.cache.get(channelId) as TextChannel;
		return discordTextSandbox.send(message);
	});

	hayaoshi.on('start-game', () => {
		logger.info('[hayaoshi] start-game');
		tts.pause();
	});

	hayaoshi.on('end-game', () => {
		logger.info('[hayaoshi] end-game');
		tts.unpause();
	});

	discord.on('message', (message) => {
		hayaoshi.onMessage(message);
		tts.onMessage(message);
	});

	discord.on('voiceStateUpdate', async (oldState, newState) => {
		if (oldState.member.user.bot) {
			return;
		}

		const nick = oldState.member.displayName;
		const eventTime = Date.now();

		// leave
		if (oldState.channel !== null && newState.channel === null) {
			const roomName = oldState.channel.name;
			const roomId = oldState.channel.id;
			const count = oldState.channel.members.size;
			const actionName = 'leave';

			if (roomNotifyCache.lastUnixTime + notifyCacheLimit > eventTime && roomNotifyCache.action === actionName) {
				roomNotifyCache.nicks.push(nick);
				await slack.chat.update({
					ts: roomNotifyCache.ts,
					channel: process.env.CHANNEL_SANDBOX,
					username: 'Discord',
					icon_emoji: ':discord:',
					text: `${nickSummarizer(roomNotifyCache.nicks)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました\n現在のアクティブ人数 ${count}人`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${nickSummarizer(roomNotifyCache.nicks)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました`,
							},
						},
						getMembersBlock(roomName, oldState.channel.members),
					],
				});
			} else {
				const response = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					username: 'Discord',
					icon_emoji: ':discord:',
					text: `${nickSummarizer([nick])}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました\n現在のアクティブ人数 ${count}人`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${nickSummarizer([nick])}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました`,
							},
						},
						getMembersBlock(roomName, oldState.channel.members),
					],
				}) as ChatPostMessageResult;
				if (response.ok) {
					roomNotifyCache.lastUnixTime = eventTime;
					roomNotifyCache.nicks = [nick];
					roomNotifyCache.ts = response.ts;
					roomNotifyCache.action = actionName;
				}
			}
		}

		// join
		if (newState.channel !== null && oldState.channel === null) {
			const roomName = newState.channel.name;
			const roomId = newState.channel.id;
			const count = newState.channel.members.size;
			const actionName = 'join';

			if (roomNotifyCache.lastUnixTime + notifyCacheLimit > eventTime && roomNotifyCache.action === actionName) {
				roomNotifyCache.nicks.push(nick);
				await slack.chat.update({
					ts: roomNotifyCache.ts,
					channel: process.env.CHANNEL_SANDBOX,
					username: 'Discord',
					icon_emoji: ':discord:',
					text: `${nickSummarizer(roomNotifyCache.nicks)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました\n現在のアクティブ人数 ${count}人`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${nickSummarizer(roomNotifyCache.nicks)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました`,
							},
						},
						getMembersBlock(roomName, newState.channel.members),
					],
				});
			} else {
				const response = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					username: 'Discord',
					icon_emoji: ':discord:',
					text: `${nickSummarizer([nick])}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました\n現在のアクティブ人数 ${count}人`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${nickSummarizer([nick])}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました`,
							},
						},
						getMembersBlock(roomName, newState.channel.members),
					],
				}) as ChatPostMessageResult;
				if (response.ok) {
					roomNotifyCache.lastUnixTime = eventTime;
					roomNotifyCache.nicks = [nick];
					roomNotifyCache.ts = response.ts;
					roomNotifyCache.action = actionName;
				}
			}
		}

		// move
		if (oldState.channel !== null && newState.channel !== null && oldState.channel.id !== newState.channel.id) {
			const newRoomName = newState.channel.name;
			const newRoomId = newState.channel.id;
			const oldRoomName = oldState.channel.name;
			const oldRoomId = oldState.channel.id;
			const actionName = `join-${oldRoomId}-${newRoomId}`;

			if (roomNotifyCache.lastUnixTime + notifyCacheLimit > eventTime && roomNotifyCache.action === actionName) {
				roomNotifyCache.nicks.push(nick);
				await slack.chat.update({
					ts: roomNotifyCache.ts,
					channel: process.env.CHANNEL_SANDBOX,
					username: 'Discord',
					icon_emoji: ':discord:',
					text: `${nickSummarizer(roomNotifyCache.nicks)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${nickSummarizer(roomNotifyCache.nicks)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
							},
						},
						getMembersBlock(oldRoomName, oldState.channel.members),
						getMembersBlock(newRoomName, newState.channel.members),
					],
				});
			} else {
				const response = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					username: 'Discord',
					icon_emoji: ':discord:',
					text: `${nickSummarizer([nick])}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${nickSummarizer([nick])}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
							},
						},
						getMembersBlock(oldRoomName, oldState.channel.members),
						getMembersBlock(newRoomName, newState.channel.members),
					],
				}) as ChatPostMessageResult;
				if (response.ok) {
					roomNotifyCache.lastUnixTime = eventTime;
					roomNotifyCache.nicks = [nick];
					roomNotifyCache.ts = response.ts;
					roomNotifyCache.action = actionName;
				}
			}
		}
	});

	rtm.on('message', async (message) => {
		if (message.text && message.subtype === undefined && message.text.startsWith('@discord ')) {
			const text = message.text.replace(/^@discord/, '').trim();
			if (text === 'ユーザー一覧') {
				await slack.chat.postMessage({
					username: 'discord',
					icon_emoji: ':discord:',
					channel: message.channel,
					text: '',
					attachments: await Promise.all(state.users.map(async (user) => ({
						author_name: await getMemberName(user.slack),
						author_icon: await getMemberIcon(user.slack),
						text: `ID: ${user.discord}`,
					}))),
				});
			} else if (text.match(/^\d+$/)) {
				const discordId = text;
				const slackId = message.user;
				if (discordId.length > 0) {
					if (state.users.some(({slack}) => slackId === slack)) {
						state.users = state.users.map((user) => user.slack === slackId ? {
							slack: slackId,
							discord: discordId,
						} : user);
					} else {
						state.users.push({slack: slackId, discord: discordId});
					}
					await slack.reactions.add({
						name: '+1',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			} else {
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
