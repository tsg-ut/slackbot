import dotenv from 'dotenv';

dotenv.config();

process.on('unhandledRejection', (error: Error) => {
	logger.error(error.stack);
});

import os from 'os';
import {rtmClient, webClient, messageClient, eventClient, tsgEventClient} from './lib/slack';
import Fastify from 'fastify';

import logger from './lib/logger';
import yargs from 'yargs';

import fastifyFormbody from 'fastify-formbody';
import fastifyExpress from 'fastify-express';

import sharp from 'sharp';

import {uniq, throttle} from 'lodash';

// Disable the cache since it likely hits the swap anyway
sharp.cache(false);

const fastify = Fastify({
	pluginTimeout: 50000,
});

const allBots = [
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
	'anime/namori',
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
];

logger.info('slackbot started');

const argv = yargs
	.array('only')
	.choices('only', allBots)
	.default('only', allBots)
	.default('startup', 'ｼｭｯｼｭｯ (起動音)')
	.argv;

const plugins = uniq(argv.only);

if (plugins.length !== argv.only.length) {
	logger.info(`Some plugins are specified more than once. Duplicated plugins were removed.`)
}

eventClient.on('error', (error) => {
	logger.error(error.stack);
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
	fastify.use('/slack-event', eventClient.expressMiddleware());
	fastify.use('/slack-message', messageClient.requestListener());

	const loadedPlugins = new Set<string>();

	const initializationMessage = await webClient.chat.postMessage({
		username: `tsgbot [${os.hostname()}]`,
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
		const plugin = await import(`./${name}`);
		if (typeof plugin === 'function') {
			await plugin({rtmClient, webClient, eventClient: tsgEventClient, messageClient});
		}
		if (typeof plugin.default === 'function') {
			await plugin.default({rtmClient, webClient, eventClient: tsgEventClient, messageClient});
		}
		if (typeof plugin.server === 'function') {
			await fastify.register(plugin.server({rtmClient, webClient, eventClient: tsgEventClient, messageClient}));
		}
		loadedPlugins.add(name);
		logger.info(`plugin "${name}" successfully loaded`);

		throttleLoadingMessageUpdate();
	}));

	fastify.listen(process.env.PORT || 21864, (error, address) => {
		if (error) {
			logger.error(error);
		} else {
			logger.info(`Server launched at ${address}`);
		}
	});

	logger.info('Launched');
	webClient.chat.postMessage({
		username: `tsgbot [${os.hostname()}]`,
		channel: process.env.CHANNEL_SANDBOX,
		text: argv.startup,
	});

	rtmClient.on('authenticated', (data) => {
		logger.info(`Logged in as ${data.self.name} of team ${data.team.name}`);
	});
})();
