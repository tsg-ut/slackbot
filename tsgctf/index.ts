/* eslint-disable import/prefer-default-export */
import {promises as fs} from 'fs';
import {join} from 'path';
import {Client} from 'Cloudstorm';
import plugin from 'fastify-plugin';
// @ts-ignore
import logger from '../lib/logger.js';
import type {SlackInterface} from '../lib/slack';

const channelInfos = new Map();

const updateChannelInfos = async (channelId: string, info: {[key: string]: string}) => {
	if (!channelInfos.has(channelId)) {
		channelInfos.set(channelId, {});
	}
	const channelInfo = channelInfos.get(channelId);
	for (const [key, value] of Object.entries(info)) {
		channelInfo[key] = value;
	}
	await fs.writeFile(
		join(__dirname, 'state.json'),
		JSON.stringify(Object.fromEntries(channelInfos)),
	);
};

const getUserName = (message: any) => {
	if (message.author.username === 'tsgctf-admin') {
		const channelInfo = channelInfos.get(message.channel_id);
		if (channelInfo === undefined) {
			return 'tsgctf-admin => UNKNOWN';
		}
		return `tsgctf-admin => ${channelInfo.username}#${channelInfo.discriminator}`;
	}
	updateChannelInfos(message.channel_id, message.author);
	return `${message.author.username}#${message.author.discriminator}`;
};

export const server = ({webClient: slack}: SlackInterface) => plugin(async (fastify, opts, next) => {
	const stateBuffer = await fs.readFile(join(__dirname, 'state.json')).catch(() => '{}');
	const state = JSON.parse(stateBuffer.toString());
	for (const [key, value] of Object.entries(state)) {
		channelInfos.set(key, value);
	}
	logger.info('Discord: loaded channel infos');

	const client = new Client(process.env.TSGCTF_DISCORD_TOKEN);
	await client.connect();
	logger.info('Discord: connected');

	client.on('event', async (event) => {
		if (event.t === 'READY') {
			logger.info('Discord: API ready');
		}

		if (event.t !== 'MESSAGE_CREATE') {
			return;
		}
		const data = event.d;

		if (data.guild_id !== undefined) {
			return;
		}

		const ts = channelInfos.has(data.channel_id) ? channelInfos.get(data.channel_id).ts : undefined;
		const icon = `https://cdn.discordapp.com/avatars/${data.author.id}/${data.author.avatar}.png?size=128`;

		const message = await slack.chat.postMessage({
			...(ts ? {thread_ts: ts, reply_broadcast: true} : {}),
			channel: process.env.CHANNEL_TSGCTF_DISCORD_BRIDGE,
			text: data.content,
			username: getUserName(data),
			icon_url: icon,
			unfurl_links: true,
			blocks: [
				{
					type: 'context',
					elements: [
						{
							type: 'image',
							image_url: icon,
							alt_text: 'icon',
						},
						{
							type: 'mrkdwn',
							text: data.content,
						},
					],
				},
			],
			attachments: data.attachments.map((attachment: any) => ({
				title: attachment.filename,
				image_url: attachment.url,
			})),
		});

		if (!ts) {
			await updateChannelInfos(data.channel_id, {ts: message.ts as string});
		}
	});

	next();
});
