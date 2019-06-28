require('dotenv').config();

process.on('unhandledRejection', (error) => {
	logger.error(error.stack);
});

const {rtmClient, webClient} = require('./lib/slack.ts');
const {createEventAdapter} = require('@slack/events-api');
const {createMessageAdapter} = require('@slack/interactive-messages');
const fastify = require('fastify')({logger: true});
const logger = require('./lib/logger.js');

fastify.register(require('fastify-formbody'));

let word2vecInstalled = true;
try {
	require.resolve('word2vec');
} catch (e) {
	word2vecInstalled = false;
}

const plugins = [
	require('./mahjong'),
	require('./pocky'),
	require('./emoji-notifier'),
	require('./sushi-bot'),
	require('./cubebot'),
	require('./shogi'),
	require('./tiobot'),
	require('./checkin'),
	require('./tahoiya'),
	require('./channel-notifier'),
	require('./tashibot'),
	require('./prime'),
	require('./dajare'),
	require('./sunrise'),
	require('./ahokusa'),
	...(word2vecInstalled ? [require('./vocabwar')] : []),
	require('./ricochet-robots'),
	require('./scrapbox'),
	require('./slack-log'),
	require('./welcome'),
	require('./deploy'),
	require('./achievements'),
	require('./mail-hook'),
	require('./wordhero'),
	require('./wordhero/crossword'),
	require('./oauth'),
	require('./tunnel'),
	require('./voiperrobot'),
];

const eventClient = createEventAdapter(process.env.SIGNING_SECRET);
const messageClient = createMessageAdapter(process.env.SIGNING_SECRET);
(async () => {
	await Promise.all(plugins.map(async (plugin) => {
		if (typeof plugin === 'function') {
			await plugin({rtmClient, webClient, eventClient, messageClient});
		}
		if (typeof plugin.default === 'function') {
			await plugin.default({rtmClient, webClient, eventClient, messageClient});
		}
		if (typeof plugin.server === 'function') {
			await fastify.register(plugin.server({rtmClient, webClient, eventClient, messageClient}));
		}
	}));

	logger.info('Launched');
	webClient.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		text: 'ｼｭｯｼｭｯ (起動音)',
	});
})();

fastify.use('/slack-event', eventClient.expressMiddleware());
fastify.use('/slack-message', messageClient.requestListener());
fastify.listen(process.env.PORT || 21864);

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
rtmClient.start();
