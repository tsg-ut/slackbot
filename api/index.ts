import Fastify from 'fastify';
import _logger from '../lib/logger';
import {getAllTSGMembers} from '../lib/slackUtils';

const logger = _logger.child({bot: 'api'});

interface RootRoute {
	Querystring: {
		return_to?: string,
	},
}

export default () => {
	const fastify = Fastify({
		logger: true,
		pluginTimeout: 50000,
	});

	fastify.get<RootRoute>('/', (request, reply) => {
		if (request.query.return_to) {
			const normalizedUrl = new URL(request.query.return_to.toString(), process.env.API_ENDPOINT).toString();
			reply.redirect(normalizedUrl);
			return;
		}

		reply.type('text/html');
		reply.send(`<h1>You successfully authorized an access to the API endpoint of <a href="https://github.com/tsg-ut/slackbot">slackbot</a>!</h1>`);
	});

	fastify.get('/slack/users', async (request, reply) => {
		const members = await getAllTSGMembers();
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
