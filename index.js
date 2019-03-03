const logger = require('./lib/logger.js');
require('dotenv').config();

process.on('unhandledRejection', (error) => {
	logger.error(error.stack);
});

const {RTMClient, WebClient} = require('@slack/client');

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
	require('./tiobot').default,
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
];

const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
const webClient = new WebClient(process.env.SLACK_TOKEN);
(async () => {
	await Promise.all(plugins.map((plugin) => plugin({rtmClient, webClient})));

	logger.info('Launched');
	webClient.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		text: 'ｼｭｯｼｭｯ (起動音)',
		username: 'slackbot',
	});
})();

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
