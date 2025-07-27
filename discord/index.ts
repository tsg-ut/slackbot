import {joinVoiceChannel} from '@discordjs/voice';
import type {DiscordGatewayAdapterCreator} from '@discordjs/voice';
import Discord, {TextChannel, VoiceChannel} from 'discord.js';
import discord from '../lib/discord';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import State from '../lib/state';
import Hayaoshi from './hayaoshi';
import {Notifier} from './notifier';
import TTS from './tts';

const log = logger.child({bot: 'discord'});

interface StateObj {
	users: {discord: string, slack: string}[],
	ttsDictionary: {key: string, value: string}[],
	introQuizSongHistory: {
		urls: string[],
	},
}

export default async ({webClient: slack, eventClient}: SlackInterface) => {
	const state = await State.init<StateObj>('discord', {
		users: [],
		ttsDictionary: [{key: 'https?:\\S*', value: 'URL省略'}],
		introQuizSongHistory: {urls: []},
	});

	const slackNotifier = new Notifier(slack);

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

	let hayaoshi = new Hayaoshi(joinVoiceChannelFn, state.users, state.introQuizSongHistory);
	let tts = new TTS(joinVoiceChannelFn, state.ttsDictionary);

	const attachDiscordHandlers = (hayaoshi: Hayaoshi, tts: TTS) => {
		hayaoshi.on('message', (message: string, channelId: string = process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) => {
			const discordTextSandbox = discord.channels.cache.get(channelId) as TextChannel;
			return discordTextSandbox.send(message);
		});

		tts.on('message', (message: string, channelId: string = process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) => {
			const discordTextSandbox = discord.channels.cache.get(channelId) as TextChannel;
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
	discord.on('messageCreate', async (message: Discord.Message) => {
		if (message.content === 'tsgbot reload') {
			log.info('reloading hayaoshi and tts');
			tts.destroy();
			hayaoshi.destroy();
			await new Promise((resolve) => setTimeout(resolve, 1000));
			hayaoshi = new Hayaoshi(joinVoiceChannelFn, state.users, state.introQuizSongHistory);
			tts = new TTS(joinVoiceChannelFn, state.ttsDictionary);
			attachDiscordHandlers(hayaoshi, tts);

			log.info('reloaded hayaoshi and tts');
			const discordTextSandbox = discord.channels.cache.get(process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) as TextChannel;
			await discordTextSandbox.send('リロードしました');

			return;
		}
		hayaoshi.onMessage(message);
		tts.onMessage(message);
	});

	discord.on('voiceStateUpdate', (oldState, newState) => {
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
