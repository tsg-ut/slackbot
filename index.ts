// XXX: sharpをcanvasより先に読み込むとエラーになるため、ここで読み込んでおく
// https://github.com/Automattic/node-canvas/issues/930
import 'canvas';

import dotenv from 'dotenv';

dotenv.config({ override: true });

import Fastify from 'fastify';
import qs from 'querystring';
import { eventClient, messageClient, tsgEventClient, webClient } from './lib/slack.js';

import yargs from 'yargs';
import logger from './lib/logger.js';

import fastifyExpress from '@fastify/express';
import fastifyFormbody from '@fastify/formbody';

import sharp from 'sharp';

import { throttle, uniq } from 'lodash';
import { RequestHandler } from 'express-serve-static-core';
import { inspect } from 'util';
import concat from 'concat-stream';
import { getAuthorityLabel } from './lib/slackUtils.js';
import { closeDuplicateEventChecker } from './lib/eventDeduplication.js';

const log = logger.child({ bot: 'index' });

process.on('unhandledRejection', (error: Error, promise: Promise<any>) => {
	log.error(`unhandledRejection at: ${promise} reason: ${error.stack ?? error.message}`, { error, stack: error.stack, promise });
});


// Disable the cache since it likely hits the swap anyway
sharp.cache(false);

const fastify = Fastify({
	logger: logger.child({ bot: 'http/index' }),
	pluginTimeout: 50000,
});

const gracefulShutdown = async (signal: string) => {
	log.info(`Received ${signal}, starting graceful shutdown...`);
	
	try {
		await fastify.close();
		log.info('Fastify server closed');
		
		await closeDuplicateEventChecker();
		log.info('Event deduplication checker closed');
		
		log.info('Graceful shutdown completed');
		process.exit(0);
	} catch (error) {
		log.error('Error during graceful shutdown', { error });
		process.exit(1);
	}
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
// pm2 restart
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
// pm2 reload
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

const productionBots = [
	'summary',
	'mahjong',
	'pocky',
	'emoji-notifier',
	'sushi-bot',
	'shogi',
	'tiobot',
	'checkin',
	'tahoiya',
	'channel-notifier',
	'prime',
	'dajare',
	'sunrise',
	'ahokusa',
	// ...(word2vecInstalled ? ['vocabwar'] : []),
	'ricochet-robots',
	'scrapbox',
	'slack-log',
	'welcome',
	'deploy',
	'achievements',
	'mail-hook',
	'wordhero',
	'wordhero/crossword',
	'oauth',
	'tunnel',
	'voiperrobot',
	'atcoder',
	'lyrics',
	'better-custom-response',
	'emoxpand',
	'ponpe',
	'anime',
	'anime/anison',
	'oogiri',
	'sorting-riddles',
	'tsglive',
	'emoji-modifier',
	'context-free',
	'room-gacha',
	'taiko',
	'hayaoshi',
	'twitter-dm-notifier',
	'hitandblow',
	'discord',
	'octas',
	'pwnyaa',
	'amongyou',
	'api',
	'hangman',
	'hakatashi-visor',
	'nojoin',
	'remember-english',
	'golfbot',
	'kirafan/quiz',
	'topic',
	'bungo-quiz',
	'adventar',
	'jantama',
	'tabi-gatcha',
	'achievement-quiz',
	'wadokaichin',
	'wordle-battle',
	'slow-quiz',
	'dicebot',
	'taimai',
	'map-guessr',
	'character-quiz',
	'shmug',
	'pilot',
	'qrcode-quiz',
	'oneiromancy',
	'auto-archiver',
	'city-symbol',
	'nmpz',
	// 'autogen-quiz',
];

const developmentBots = [
	'helloworld',
];

const allBots = [...productionBots, ...developmentBots];

log.info('slackbot started');

const argv = yargs
	.array('only')
	.choices('only', allBots)
	.default('only', productionBots)
	.default('startup', 'ｼｭｯｼｭｯ (起動音)')
	.argv;

const plugins = uniq(argv.only);

if (plugins.length !== argv.only.length) {
	log.info(`Some plugins are specified more than once. Duplicated plugins were removed.`)
}

eventClient.on('error', (error) => {
	log.error(`EventsAPI error ${error.message}`, { error, stack: error.stack });
});

(async () => {
	await fastify.register(fastifyFormbody);
	await fastify.register(fastifyExpress);

	fastify.use('/slack-event', (req, res, next) => {
		if (!{}.hasOwnProperty.call(req.headers, 'x-slack-signature')) {
			res.statusCode = 400;
			res.end('Bad Request');
			return;
		}
		next();
	});

	const loggingHandler = (type: string): RequestHandler => (
		async (req, res, next) => {
			const body = await new Promise((resolve) => {
				req.pipe(concat((body) => {
					resolve(body);
				}));
			});
			const decodedBody = body.toString();
			const header = `Incoming ${type}:\n`;

			let data = null;
			if (decodedBody.startsWith('{')) {
				data = JSON.parse(decodedBody);
			} else {
				const parsedBody = qs.parse(decodedBody);
				data = parsedBody?.payload ? JSON.parse(parsedBody.payload.toString()) : parsedBody;
			}

			const inspectedBody = inspect(type === 'Event' ? data?.event : data, { colors: true })
			log.info(header + inspectedBody);

			// @ts-expect-error
			req.rawBody = Buffer.from(body);
			next();
		}
	);

	fastify.use('/slack-event', loggingHandler('Event'));
	fastify.use('/slack-event', eventClient.expressMiddleware());
	fastify.use('/slack-message', loggingHandler('Interactive Message'));
	fastify.use('/slack-message', messageClient.requestListener());

	const loadedPlugins = new Set<string>();
	const authority = getAuthorityLabel();

	const initializationMessage = await webClient.chat.postMessage({
		username: `tsgbot [${authority}]`,
		channel: process.env.CHANNEL_SANDBOX,
		text: `起動中⋯⋯ (${loadedPlugins.size}/${plugins.length})`,
		attachments: plugins.map((name) => ({
			color: '#F44336',
			text: `*loading:* ${name}`,
		})),
	});

	const throttleLoadingMessageUpdate = throttle(() => {
		webClient.chat.update({
			channel: process.env.CHANNEL_SANDBOX,
			ts: initializationMessage.ts as string,
			text: `起動中⋯⋯ (${loadedPlugins.size}/${plugins.length})`,
			attachments: [
				{
					color: '#4CAF50',
					text: `*loaded:* ${Array.from(loadedPlugins).join(', ')}`,
				},
				...plugins.filter((name) => !loadedPlugins.has(name)).map((name) => ({
					color: '#F44336',
					text: `*loading:* ${name}`,
				})),
			],
		})
	}, 0.5 * 1000);

	await Promise.all(plugins.map(async (name) => {
		const plugin = await import(`./${name}/index.js`);
		if (typeof plugin === 'function') {
			await plugin({ webClient, eventClient: tsgEventClient, messageClient });
		}
		if (typeof plugin.default === 'function') {
			await plugin.default({ webClient, eventClient: tsgEventClient, messageClient });
		}
		if (typeof plugin.server === 'function') {
			await fastify.register(plugin.server({ webClient, eventClient: tsgEventClient, messageClient }));
		}
		loadedPlugins.add(name);
		log.info(`plugin "${name}" successfully loaded`);

		throttleLoadingMessageUpdate();
	}));

	fastify.listen({
		port: process.env.PORT ? parseInt(process.env.PORT) : 21864,
		host: '0.0.0.0',
	}, (error, address) => {
		if (error) {
			log.error(`fastify.listen error ${error.message}`, { error, stack: error.stack });
		} else {
			log.info(`Server launched at ${address}`);
		}
	});

	log.info('Launched');
	webClient.chat.postMessage({
		username: `tsgbot [${authority}]`,
		channel: process.env.CHANNEL_SANDBOX,
		text: argv.startup,
	});
})();
