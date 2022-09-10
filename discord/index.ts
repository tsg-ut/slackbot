import {VoiceConnectionStatus, joinVoiceChannel} from '@discordjs/voice';
import type {DiscordGatewayAdapterCreator} from '@discordjs/voice';
import type {ContextBlock, WebAPICallResult} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import Discord, {Intents, TextChannel, Collection, Snowflake, GuildMember, VoiceChannel} from 'discord.js';
import _logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import State from '../lib/state';
import Hayaoshi from './hayaoshi';
import TTS from './tts';

const logger = _logger.child({bot: 'discord'});

interface ChatPostMessageResult extends WebAPICallResult {
	ts: string;
}

interface StateObj {
	users: {discord: string, slack: string}[],
	ttsDictionary: {key: string, value: string}[],
}

// eslint-disable-next-line import/no-named-as-default-member
const discord = new Discord.Client({
	intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_VOICE_STATES],
});
discord.login(process.env.TSGBOT_DISCORD_TOKEN);

const mutex = new Mutex();

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

export default async ({webClient: slack, eventClient}: SlackInterface) => {
	const state = await State.init<StateObj>('discord', {
		users: [],
		ttsDictionary: [{key: 'https?:\\S*', value: 'URL省略'}],
	});

	const joinVoiceChannelFn = (channelId: string = process.env.DISCORD_SANDBOX_VOICE_CHANNEL_ID) => {
		const channel = discord.channels.cache.get(channelId) as VoiceChannel;
		const connection = joinVoiceChannel({
			channelId,
			guildId: channel.guild.id,
			// https://github.com/discordjs/voice/issues/166
			adapterCreator: channel.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
		});
		return connection;
	};
	const roomNotifyCache = {
		lastUnixTime: 0, usernames: <string[]>[], ts: '', action: '',
	};
	const notifyCacheLimit = 60000; // 1min
	const usernameSummarizer = (usernames: string[]) => {
		if (usernames.length >= 3) {
			return `＊${usernames[0]}＊, ＊${usernames[1]}＊, ほか${usernames.length - 2}名`;
		} else if (usernames.length === 2) {
			return `＊${usernames[0]}＊, ＊${usernames[1]}＊`;
		} else if (usernames.length === 1) {
			return `＊${usernames[0]}＊`;
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

	const postMessage = async (
		{text, count, rooms, ts}: {
			text: string,
			count: number,
			rooms: {
				name: string,
				members: Discord.Collection<string, Discord.GuildMember>,
			}[],
			ts: string,
		},
	) => {
		const countText = count === null ? '' : `現在のアクティブ人数 ${count}人`;

		if (ts) {
			const result = await slack.chat.update({
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
					...rooms.map((room) => getMembersBlock(room.name, room.members)),
				],
			}) as ChatPostMessageResult;
			return result;
		}

		const response = await slack.chat.postMessage({
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
				...rooms.map((room) => getMembersBlock(room.name, room.members)),
			],
		}) as ChatPostMessageResult;
		return response;
	};

	discord.on('voiceStateUpdate', (oldState, newState) => {
		if (oldState.member.user.bot) {
			return;
		}

		const username = oldState.member.displayName;
		const eventTime = Date.now();

		mutex.runExclusive(async () => {
			// leave
			if (oldState.channel !== null && newState.channel === null) {
				const roomName = oldState.channel.name;
				const roomId = oldState.channel.id;
				const count = oldState.channel.members.size;
				const actionName = 'leave';
				const update = roomNotifyCache.lastUnixTime + notifyCacheLimit > eventTime && roomNotifyCache.action === actionName;

				if (update) {
					roomNotifyCache.usernames.push(username);
				} else {
					roomNotifyCache.usernames = [username];
				}

				const response = await postMessage({
					text: `${usernameSummarizer(roomNotifyCache.usernames)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>からログアウトしました`,
					count,
					rooms: [{name: roomName, members: oldState.channel.members}],
					ts: update ? roomNotifyCache.ts : null,
				});

				if (!update && response.ok) {
					roomNotifyCache.ts = response.ts;
				}

				roomNotifyCache.action = actionName;
				roomNotifyCache.lastUnixTime = eventTime;
			}

			// join
			if (newState.channel !== null && oldState.channel === null) {
				const roomName = newState.channel.name;
				const roomId = newState.channel.id;
				const count = newState.channel.members.size;
				const actionName = 'join';
				const update = roomNotifyCache.lastUnixTime + notifyCacheLimit > eventTime && roomNotifyCache.action === actionName;

				if (update) {
					roomNotifyCache.usernames.push(username);
				} else {
					roomNotifyCache.usernames = [username];
				}

				const response = await postMessage({
					text: `${usernameSummarizer(roomNotifyCache.usernames)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${roomId}|${roomName}>にログインしました`,
					count,
					rooms: [{name: roomName, members: newState.channel.members}],
					ts: update ? roomNotifyCache.ts : null,
				});

				if (!update && response.ok) {
					roomNotifyCache.ts = response.ts;
				}

				roomNotifyCache.action = actionName;
				roomNotifyCache.lastUnixTime = eventTime;
			}

			// move
			if (oldState.channel !== null && newState.channel !== null && oldState.channel.id !== newState.channel.id) {
				const newRoomName = newState.channel.name;
				const newRoomId = newState.channel.id;
				const oldRoomName = oldState.channel.name;
				const oldRoomId = oldState.channel.id;
				const actionName = `join-${oldRoomId}-${newRoomId}`;
				const update = roomNotifyCache.lastUnixTime + notifyCacheLimit > eventTime && roomNotifyCache.action === actionName;

				if (update) {
					roomNotifyCache.usernames.push(username);
				} else {
					roomNotifyCache.usernames = [username];
				}

				const response = await postMessage({
					text: `${usernameSummarizer(roomNotifyCache.usernames)}が<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${oldRoomId}|${oldRoomName}>から<https://discord.com/channels/${process.env.DISCORD_SERVER_ID}/${newRoomId}|${newRoomName}>に移動しました`,
					count: null,
					rooms: [
						{name: oldRoomName, members: oldState.channel.members},
						{name: newRoomName, members: newState.channel.members},
					],
					ts: update ? roomNotifyCache.ts : null,
				});

				if (!update && response.ok) {
					roomNotifyCache.ts = response.ts;
				}

				roomNotifyCache.action = actionName;
				roomNotifyCache.lastUnixTime = eventTime;
			}
		});
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
