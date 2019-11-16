import {RTMClient, WebClient} from '@slack/client';
import db from '../lib/firestore';
import {getMemberName} from '../lib/slackUtils';
import plugin from 'fastify-plugin';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export const server = ({webClient: slack}: SlackInterface) => plugin(async (fastify, opts, next) => {
	const {team}: any = await slack.team.info();

	fastify.post('/slash/tsglive', async (req, res) => {
		if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
			res.code(400);
			return 'Bad Request';
		}
		if (req.body.team_id !== team.id) {
			res.code(200);
			return '/tsglive is only for TSG. Sorry!';
		}

		let teamId = null;
		if (req.body.channel_name === 'live-players-hongo') {
			teamId = 0;
		} else if (req.body.channel_name === 'live-players-komaba') {
			teamId = 1;
		} else {
			return '#live-players-hongo もしくは #live-players-komaba チャンネルから実行してください';
		}

		const name = await getMemberName(req.body.user_id);

		await db.collection('tsglive_comments').add({
			user: req.body.user_id,
			name,
			text: req.body.text,
			date: new Date(),
			team: teamId,
		});

		const emoji = teamId === 0 ? ':red_circle:' : ':large_blue_circle:';

		await slack.chat.postMessage({
			channel: req.body.channel_id,
			username: `${req.body.user_name} (tsg-live-controller)`,
			icon_emoji: emoji,
			text: req.body.text,
		});

		await slack.chat.postMessage({
			channel: 'CARFNJLJX',
			username: `${req.body.user_name} (tsg-live-controller)`,
			icon_emoji: emoji,
			text: req.body.text,
		});

		return '';
	});

	next();
});
