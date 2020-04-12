require('dotenv').config();

process.on('unhandledRejection', (error) => {
	logger.error(error.stack);
});

const {rtmClient, webClient} = require('./lib/slack.ts');
const {createEventAdapter} = require('@slack/events-api');
const {createMessageAdapter} = require('@slack/interactive-messages');
const fastify = require('fastify')({logger: true});
const logger = require('./lib/logger.js');
const yargs = require('yargs');

fastify.register(require('fastify-formbody'));

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
];

const argv = yargs
	.array('only')
	.choices('only', allBots)
	.default('only', allBots)
	.default('startup', 'ｼｭｯｼｭｯ (起動音)')
	.argv;

const plugins = Object.fromEntries(argv.only.map((name) => [name, require(`./${name}`)]));
const eventClient = createEventAdapter(process.env.SIGNING_SECRET);
eventClient.on('error', (error) => {
	logger.error(error.stack);
});

const messageClient = createMessageAdapter(process.env.SIGNING_SECRET);

(async () => {
	await Promise.all(Object.entries(plugins).map(async ([name, plugin]) => {
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
		channel: process.env.CHANNEL_SANDBOX,
		text: argv.startup,
	});
})();

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

let firstLogin = true;
rtmClient.on('authenticated', (data) => {
	logger.info(`Logged in as ${data.self.name} of team ${data.team.name}`);
	if (!firstLogin) {
		webClient.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: '再接続しました',
		});
	}
	firstLogin = false;
});
