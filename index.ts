import dotenv from 'dotenv';

dotenv.config();

process.on('unhandledRejection', (error: Error) => {
	logger.error(error.stack);
});

import os from 'os';
import {rtmClient, webClient} from './lib/slack';
import {createEventAdapter} from '@slack/events-api';
import {createMessageAdapter} from '@slack/interactive-messages';
import Fastify from 'fastify';

// @ts-ignore
import logger from './lib/logger.js';
import yargs from 'yargs';

import fastifyFormbody from 'fastify-formbody';
import fastifyExpress from 'fastify-express';

const fastify = Fastify({
	logger: true,
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
	'ojigineko-life',
	'better-custom-response',
	'emoxpand',
	'ponpe',
	'anime',
	'anime/anison',
	'oogiri',
	'sort-nazonazo',
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
];

const argv = yargs
	.array('only')
	.choices('only', allBots)
	.default('only', allBots)
	.default('startup', 'ｼｭｯｼｭｯ (起動音)')
	.argv;

const plugins = Object.fromEntries(argv.only.map((name) => [name, import(`./${name}`)]));
const eventClient = createEventAdapter(process.env.SIGNING_SECRET);
eventClient.on('error', (error) => {
	logger.error(error.stack);
});

const messageClient = createMessageAdapter(process.env.SIGNING_SECRET);

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
	fastify.listen(process.env.PORT || 21864, (error, address) => {
		if (error) {
			logger.error(error);
		} else {
			logger.info(`Server launched at ${address}`);
		}
	});

	await Promise.all(Object.entries(plugins).map(async ([name, pluginPromise]) => {
		const plugin = await pluginPromise;
		if (typeof plugin === 'function') {
			await plugin({rtmClient, webClient, eventClient, messageClient});
		}
		if (typeof plugin.default === 'function') {
			await plugin.default({rtmClient, webClient, eventClient, messageClient});
		}
		if (typeof plugin.server === 'function') {
			await fastify.register(plugin.server({rtmClient, webClient, eventClient, messageClient}));
		}
		logger.info(`plugin "${name}" successfully loaded`);
	}));

	logger.info('Launched');
	webClient.chat.postMessage({
		username: `tsgbot [${os.hostname()}]`,
		channel: process.env.CHANNEL_SANDBOX,
		text: argv.startup,
	});

	let firstLogin = true;
	let lastLogin: number = null;
	let combos = 1;
	rtmClient.on('authenticated', (data) => {
		logger.info(`Logged in as ${data.self.name} of team ${data.team.name}`);
		const now = Date.now();
		if (!firstLogin) {
			let comboStr = '';
			if (now - lastLogin <= 2 * 60 * 1000) {
				combos++;
				comboStr = `(${combos}コンボ${'!'.repeat(combos)})`
			}
			else {
				combos = 1;
			}
			webClient.chat.postMessage({
				username: `tsgbot [${os.hostname()}]`,
				channel: process.env.CHANNEL_SANDBOX,
				text: `再接続しました ${comboStr}`,
			});
		}
		firstLogin = false;
		lastLogin = now;
	});
})();