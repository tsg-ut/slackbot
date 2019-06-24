import {FastifyInstance} from 'fastify';
import {WebClient} from '@slack/client';
// @ts-ignore
import logger from '../lib/logger.js';

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
	fastify.get('/oauth', async (req, res) => {
		const data = await slack.oauth.access({
			code: req.query.code,
			client_id: process.env.CLIENT_ID,
			client_secret: process.env.CLIENT_SECRET,
		});
		if (!data.ok) {
			res.code(500);
			logger.error(data);
			return 'Internal Server Error';
		}
		return 'Successfully installed tsgbot to your workspace';
	});
};
