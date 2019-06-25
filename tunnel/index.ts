import {RTMClient, WebClient} from '@slack/client';
import sql from 'sql-template-strings';
import sqlite from 'sqlite';
import path from 'path';
import plugin from 'fastify-plugin';
import {get} from 'lodash';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

const messages = new Map();

let isTsgAllowing = true;
let isKmcAllowing = true;

export const server = ({webClient: tsgSlack, rtmClient: tsgRtm}: SlackInterface) => plugin(async (fastify, opts, next) => {
	const db = await sqlite.open(path.join(__dirname, '..', 'tokens.sqlite3'));
	const kmcToken = await db.get(sql`SELECT * FROM tokens WHERE team_id = ${process.env.KMC_TEAM_ID}`);
	const kmcSlack = kmcToken === undefined ? null : new WebClient(kmcToken.bot_access_token);
	const kmcRtm = kmcToken === undefined ? null : new RTMClient(kmcToken.bot_access_token);

	const {team: tsgTeam}: any = await tsgSlack.team.info();

	fastify.post('/slash/tunnel', async (req, res) => {
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

		const user = await new Promise((resolve) => {
			if (teamName === 'TSG') {
				resolve(tsgSlack.users.info({
					user: req.body.user_id,
				}));
			} else {
				resolve(kmcSlack.users.info({
					user: req.body.user_id,
				}));
			}
		});
		const iconUrl = get(user, ['user', 'profile', 'image_192'], '');
		const name = get(user, ['user', 'profile', 'display_name'], '');

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

	const onReactionAdded = async (event: any, team: string) => {
		const message = messages.get(event.item.ts);
		if (!message) {
			return;
		}
		const user = await new Promise((resolve) => {
			if (team === 'TSG') {
				resolve(tsgSlack.users.info({
					user: event.user,
				}));
			} else {
				resolve(kmcSlack.users.info({
					user: event.user,
				}));
			}
		});
		const iconUrl = get(user, ['user', 'profile', 'image_192'], '');
		const name = get(user, ['user', 'profile', 'display_name'], '');
		if (message.team === 'TSG') {
			await tsgSlack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `+:${event.reaction}:`,
				username: `${name}@${team}`,
				icon_url: iconUrl,
				thread_ts: message.ts,
			});
		} else {
			await kmcSlack.chat.postMessage({
				channel: process.env.KMC_CHANNEL_SANDBOX,
				text: `+:${event.reaction}:`,
				username: `${name}@${team}`,
				icon_url: iconUrl,
				thread_ts: message.ts,
			});
		}
	};

	tsgRtm.on('reaction_added', (event) => {
		onReactionAdded(event, 'TSG');
	});

	kmcRtm.on('reaction_added', (event) => {
		onReactionAdded(event, 'KMC');
	});

	kmcRtm.start();

	next();
});
