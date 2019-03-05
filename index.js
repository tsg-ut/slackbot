require('dotenv').config();

process.on('unhandledRejection', (error) => {
	logger.error(error.stack);
});

const {RTMClient, WebClient} = require('@slack/client');
const fastify = require('fastify')({logger: true});
const logger = require('./lib/logger.js');

let word2vecInstalled = true;
try {
	require.resolve('word2vec');
} catch (e) {
	word2vecInstalled = false;
}

const plugins = [
	require('./scrapbox'),
];

const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
const webClient = new WebClient(process.env.SLACK_TOKEN);
(async () => {
	await Promise.all(plugins.map(async (plugin) => {
		if (typeof plugin === 'function') {
			await plugin({rtmClient, webClient});
		}
		if (typeof plugin.default === 'function') {
			await plugin.default({rtmClient, webClient});
		}
		if (typeof plugin.server === 'function') {
			await fastify.register(plugin.server({rtmClient, webClient}));
		}
	}));

	logger.info('Launched');
	webClient.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		text: 'ｼｭｯｼｭｯ (起動音)',
		username: 'slackbot',
	});
})();

fastify.listen(process.env.PORT || 21864);

let firstLogin = true;
rtmClient.on('authenticated', (data) => {
	logger.info(`Logged in as ${data.self.name} of team ${data.team.name}`);
	if (!firstLogin) {
		webClient.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: '再接続しました',
			username: 'slackbot',
		});
	}
	firstLogin = false;
});
rtmClient.start();
