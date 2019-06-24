import {FastifyInstance} from 'fastify';
import {WebClient} from '@slack/client';

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
	fastify.post('/slash/tunnel', async (req, res) => {
		res.code(501);
		return 'unimplemented';
	});
};
