import Fastify from 'fastify';
// @ts-ignore
import logger from '../lib/logger.js';
import {getAllMembers} from '../lib/slackUtils';

export default () => {
	const fastify = Fastify({
		logger: true,
		pluginTimeout: 50000,
	});

	fastify.get('/slack/users', async (request, reply) => {
		const members = await getAllMembers();
		reply.send(members);
	});

	fastify.listen(process.env.API_PORT || 20137, (error, address) => {
		if (error) {
			logger.error(error);
		} else {
			logger.info(`API server launched at ${address}`);
		}
	});
};
