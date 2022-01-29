import path from 'path';
import {WebClient} from '@slack/web-api';
import {EmojiData} from 'emoji-data-ts';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
import {flatten, uniq} from 'lodash';
import sql from 'sql-template-strings';
import {open} from 'sqlite';
import sqlite3 from 'sqlite3';
import logger from '../lib/logger';
import type {SlackInterface, SlashCommandEndpoint} from '../lib/slack';

import {getEmoji, getMemberIcon, getMemberName} from '../lib/slackUtils';

const messages = new Map();

let isTsgAllowing = true;
let isKmcAllowing = true;

const emojiData = new EmojiData();
const getEmojiImageUrl = async (name: string, team: string): Promise<string> => {
	const emojiUrl = await getEmoji(name, team);
	if (emojiUrl !== undefined) {
		return emojiUrl;
	}
	const emoji = emojiData.getImageData(name);
	if (emoji) {
		return `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-64/${emoji.imageUrl}`;
	}
	return null;
};

export const server = ({webClient: tsgSlack, eventClient}: SlackInterface) => {
	const callback: FastifyPluginCallback = async (fastify, opts, next) => {
		const db = await open({
			filename: path.join(__dirname, '..', 'tokens.sqlite3'),
			driver: sqlite3.Database,
		});
		const kmcToken = await db.get(sql`SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`).catch(() => null);
		await db.close();

		const kmcSlack = kmcToken === undefined ? null : new WebClient(kmcToken.bot_access_token);

		const {team: tsgTeam}: any = await tsgSlack.team.info();

		fastify.post<SlashCommandEndpoint>('/slash/tunnel', async (req, res) => {
			if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				res.code(400);
				return 'Bad Request';
			}
			if (kmcToken === undefined) {
				res.code(500);
				return 'Slack token for KMC is not found';
			}
			if (req.body.team_id !== tsgTeam.id && req.body.team_id !== process.env.KMC_TEAM_ID) {
				res.code(400);
				return 'Bad Request';
			}
			const teamName = req.body.team_id === tsgTeam.id ? 'TSG' : 'KMC';
			const isAllowingSend = teamName === 'TSG' ? isTsgAllowing : isKmcAllowing;
			const isAllowingReceive = teamName === 'TSG' ? isKmcAllowing : isTsgAllowing;

			if (req.body.text.trim() === 'allow') {
				if (isAllowingSend) {
					return '受信拒否は設定されてないよ';
				}
				if (teamName === 'TSG') {
					isTsgAllowing = true;
				} else {
					isKmcAllowing = true;
				}
				return '受信拒否を解除したよ:+1:';
			}

			if (req.body.text.trim() === 'deny') {
				if (!isAllowingSend) {
					return '現在、受信拒否中だよ';
				}
				if (teamName === 'TSG') {
					isTsgAllowing = false;
				} else {
					isKmcAllowing = false;
				}
				return '受信拒否を設定したよ:cry:';
			}

			if (!isAllowingSend) {
				return '受信拒否設定中はメッセージを送れません:innocent:';
			}

			if (!isAllowingReceive) {
				return '受信拒否されているのでメッセージを送れません:cry:';
			}

			const iconUrl = await getMemberIcon(req.body.user_id, 192);
			const name = await getMemberName(req.body.user_id);

			const [{ts: tsgTs}, {ts: kmcTs}]: any = await Promise.all([
				tsgSlack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: req.body.text,
					username: `${name || req.body.user_name}@${teamName}`,
					icon_url: iconUrl,
					unfurl_links: true,
				}),
				kmcSlack.chat.postMessage({
					channel: process.env.KMC_CHANNEL_SANDBOX,
					text: req.body.text,
					username: `${name || req.body.user_name}@${teamName}`,
					icon_url: iconUrl,
					unfurl_links: true,
				}),
			]);

			messages.set(tsgTs, {team: 'KMC', ts: kmcTs});
			messages.set(kmcTs, {team: 'TSG', ts: tsgTs});

			return '';
		});

		const onReactionUpdated = async (event: any, updatedTeam: string) => {
			// update message of the other team
			const updatingMessageData = messages.get(event.item.ts);
			if (!updatingMessageData) {
				return;
			}

			// fetch message detail
			// eslint-disable-next-line prefer-destructuring
			const updatedMessage: {ts: string, text: string, blocks: any[], reactions: any[]} = (await tsgSlack.conversations.history({
				token: updatedTeam === 'TSG' ? process.env.HAKATASHI_TOKEN : kmcToken.access_token,
				channel: updatedTeam === 'TSG' ? process.env.CHANNEL_SANDBOX : process.env.KMC_CHANNEL_SANDBOX,
				latest: event.item.ts,
				limit: 1,
				inclusive: true,
			}) as any).messages[0];

			if (updatedMessage.ts !== event.item.ts) {
				// message not found
				return;
			}

			const teamId = updatedTeam === 'TSG' ? tsgTeam.id : process.env.KMC_TEAM_ID;

			const users = uniq(flatten(updatedMessage.reactions.map((reaction) => reaction.users)));
			const userNames = await Promise.all(users.map(async (user) => {
				const name = await getMemberName(user);
				return [user, name] as [string, string];
			}));
			const userNameMap = new Map(userNames);

			const emojis = updatedMessage.reactions.map((reaction) => reaction.name);
			const emojiUrls = await Promise.all(emojis.map(async (emoji) => {
				const url = await getEmojiImageUrl(emoji, teamId);
				return [emoji, url] as [string, string];
			}));
			const emojiUrlMap = new Map(emojiUrls);

			const blocks = [
				(updatedMessage.blocks ? updatedMessage.blocks[0] : {
					type: 'section',
					text: {
						type: 'mrkdwn',
						verbatim: true,
						text: updatedMessage.text,
					},
				}),
				...updatedMessage.reactions
					.map((reaction: {name: string, users: string[]}) => (
						emojiUrlMap.has(reaction.name)
							? [
								{
									type: 'image',
									image_url: emojiUrlMap.get(reaction.name),
									alt_text: `:${reaction.name}: by ${
										reaction.users.map((user) => userNameMap.get(user)).join(', ')
									}`,
								},
								{
									type: 'mrkdwn',
									text: `${reaction.users.length}`,
								},
							] : [ // TODO: use image for non-custom emojis too
								{
									type: 'mrkdwn',
									text: `:${reaction.name}: ${reaction.users.length}`,
								},
							]
					))
					.reduce(({rows, cnt}, reaction) => {
						if (cnt + reaction.length > 10) {
							// next line
							rows.push([reaction]);
							return {rows, cnt: reaction.length};
						}
						rows[rows.length - 1].push(reaction);
						return {rows, cnt: cnt + reaction.length};
					}, {rows: [[]], cnt: 0}).rows
					.map(flatten)
					.map((elements) => ({
						type: 'context',
						elements,
					})),
			];

			if (updatingMessageData.team === 'TSG') {
				await tsgSlack.chat.update({
					channel: process.env.CHANNEL_SANDBOX,
					text: '',
					ts: updatingMessageData.ts,
					blocks: blocks.slice(0, 50),
				});
			} else {
				await kmcSlack.chat.update({
					channel: process.env.KMC_CHANNEL_SANDBOX,
					text: '',
					ts: updatingMessageData.ts,
					blocks: blocks.slice(0, 50),
				});
			}
		};

		for (const eventType of ['reaction_added', 'reaction_removed']) {
			eventClient.on(eventType, (event: any) => {
				const team =
					event.team_id === process.env.TEAM_ID ? 'TSG'
						: event.team_id === process.env.KMC_TEAM_ID ? 'KMC'
							: null;

				if (!team) {
					logger.warn(`unknown team: ${event.team_id}`);
					return;
				}

				onReactionUpdated(event, team);
			});
		}

		next();
	};

	return plugin(callback);
};
