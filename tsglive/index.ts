import {RTMClient, WebClient} from '@slack/client';
import {getMemberName} from '../lib/slackUtils';
import plugin from 'fastify-plugin';
import db from '../lib/firestore';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export const server = ({webClient: tsgSlack, rtmClient: tsgRtm}: SlackInterface) => plugin(async (fastify, opts, next) => {
	const {team: tsgTeam}: any = await tsgSlack.team.info();

	fastify.post('/slash/tsglive', async (req, res) => {
		if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
			res.code(400);
			return 'Bad Request';
		}
		if (req.body.team_id !== tsgTeam.id) {
			res.code(200);
			return '/tsglive is only for TSG. Sorry!';
		}

		const name = await getMemberName(req.body.user_id);

		return '';
	});

	next();
});
