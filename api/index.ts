import Fastify from 'fastify';
import db from '../lib/firestore';
import logger from '../lib/logger';
import {getAllTSGMembers} from '../lib/slackUtils';
import {addLike, removeLike} from '../topic';

const log = logger.child({bot: 'api'});

interface RootRoute {
	Querystring: {
		return_to?: string,
	},
}

export default () => {
	const fastify = Fastify({
		logger: logger.child({bot: 'http/api'}),
		pluginTimeout: 50000,
	});

	fastify.get<RootRoute>('/', (request, reply) => {
		if (request.query.return_to) {
			const normalizedUrl = new URL(request.query.return_to.toString(), process.env.API_ENDPOINT).toString();
			reply.redirect(normalizedUrl);
			return;
		}

		reply.type('text/html');
		reply.send('<h1>You successfully authorized an access to the API endpoint of <a href="https://github.com/tsg-ut/slackbot">slackbot</a>!</h1>');
	});

	fastify.get('/slack/users', async (request, reply) => {
		const members = await getAllTSGMembers();
		reply.send(members);
	});

	fastify.get('/topic/topics', async (request, reply) => {
		const topics = await db.collection('topic_messages').get();
		reply.send(topics.docs.map((doc) => doc.data()));
	});

	fastify.put('/topic/like', async (request, reply) => {
		const user = request.headers['x-user'];
		const {ts} = request.body as {ts: string};
		if (typeof user !== 'string' || typeof ts !== 'string') {
			reply.statusCode = 400;
			reply.send('Bad Request');
			return;
		}

		await addLike(user, ts);
		reply.send('ok');
	});

	fastify.delete('/topic/like', async (request, reply) => {
		const user = request.headers['x-user'];
		const {ts} = request.body as {ts: string};
		if (typeof user !== 'string' || typeof ts !== 'string') {
			reply.statusCode = 400;
			reply.send('Bad Request');
			return;
		}

		await removeLike(user, ts);
		reply.send('ok');
	});

	fastify.listen({
		port: process.env.API_PORT ? parseInt(process.env.API_PORT) : 20137,
		host: '0.0.0.0',
	}, (error, address) => {
		if (error) {
			log.error(error);
		} else {
			log.info(`API server launched at ${address}`);
		}
	});
};
