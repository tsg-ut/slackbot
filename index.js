require('dotenv').config();

process.on('unhandledRejection', (error) => {
	logger.error(error.stack);
});

const {RTMClient, WebClient} = require('@slack/client');
const {createEventAdapter} = require('@slack/events-api');
const fastify = require('fastify')({logger: true});
const logger = require('./lib/logger.js');

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
	require('./deploy'),
];

const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
const webClient = new WebClient(process.env.SLACK_TOKEN);
const eventClient = createEventAdapter(process.env.SIGNING_SECRET);
(async () => {
	await Promise.all(plugins.map(async (plugin) => {
		if (typeof plugin === 'function') {
			await plugin({rtmClient, webClient, eventClient});
		}
		if (typeof plugin.default === 'function') {
			await plugin.default({rtmClient, webClient, eventClient});
		}
		if (typeof plugin.server === 'function') {
			await fastify.register(plugin.server({rtmClient, webClient, eventClient}));
		}
	}));

	logger.info('Launched');
	webClient.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		text: 'ｼｭｯｼｭｯ (起動音)',
	});
})();

fastify.use('/slack-event', eventClient.expressMiddleware());
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
