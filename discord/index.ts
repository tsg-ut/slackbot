import type {ContextBlock} from '@slack/web-api';
import Discord, {TextChannel, Collection, Snowflake, GuildMember, VoiceChannel} from 'discord.js';
import type {SlackInterface} from '../lib/slack';
import {getMemberName} from '../lib/slackUtils';
import Hayaoshi from './hayaoshi';
import {v1beta1 as GoogleCloudTextToSpeech} from '@google-cloud/text-to-speech';
import {promises as fs} from 'fs';
import path from 'path';

const {TextToSpeechClient} = GoogleCloudTextToSpeech;
const client = new TextToSpeechClient();

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
	const hayaoshi = new Hayaoshi(() => {
		const discordSandbox = discord.channels.cache.get(process.env.DISCORD_SANDBOX_VOICE_CHANNEL_ID) as VoiceChannel;
		return discordSandbox.join();
	});

	hayaoshi.on('message', (message: string) => {
		const discordTextSandbox = discord.channels.cache.get(process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) as TextChannel;
		return discordTextSandbox.send(message);
	});

	let connection: Discord.VoiceConnection = null;
	const ttsUsers: string[] = [];

	discord.on('message', async (message) => {
		if (message.channel.id === process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID && !message.member.user.bot) {
			hayaoshi.onMessage(message);
			if (message.content === 'TTS') {
				const discordSandbox = discord.channels.cache.get(process.env.DISCORD_SANDBOX_VOICE_CHANNEL_ID) as VoiceChannel;
				connection = await discordSandbox.join();

				const discordTextSandbox = discord.channels.cache.get(process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID) as TextChannel;
				discordTextSandbox.send('ok');

				ttsUsers.push(message.member.user.id);
			} else if (ttsUsers.includes(message.member.user.id)) {
				const index = ttsUsers.indexOf(message.member.user.id);
				const id = ['A', 'C', 'B', 'D'][index];
				const [response] = await client.synthesizeSpeech({
					input: {
						ssml: message.content,
					},
					voice: {
						languageCode: 'ja-JP',
						name: `ja-JP-Wavenet-${id}`,
					},
					audioConfig: {
						audioEncoding: 'MP3',
						speakingRate: 1.2,
						effectsProfileId: ['headphone-class-device'],
					},
					// @ts-ignore
					enableTimePointing: ['SSML_MARK'],
				});
				await fs.writeFile(path.join(__dirname, 'tempAudio.mp3'), response.audioContent, 'binary');
				
				await new Promise<void>((resolve) => {
					const dispatcher = connection.play(path.join(__dirname, 'tempAudio.mp3'));
					dispatcher.on('finish', () => {
						resolve();
					});
				});
			}
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
