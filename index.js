require('dotenv').config();

process.on('unhandledRejection', (error) => {
	console.error(error.stack);
});

const {RTMClient, WebClient} = require('@slack/client');

const plugins = [
	require('./mahjong'),
	require('./pocky'),
	require('./emoji-notifier'),
	require('./sushi-bot'),
	require('./cubebot'),
	require('./shogi'),
	require('./tiobot'),
	require('./math'),
	require('./checkin'),
	require('./tahoiya'),
	require('./channel-notifier'),
	require('./tashibot'),
];

const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
const webClient = new WebClient(process.env.SLACK_TOKEN);

for (const plugin of plugins) {
	plugin({rtmClient, webClient});
}

logger.info('Launched');
webClient.chat.postMessage({
	channel: process.env.CHANNEL_SANDBOX,
	text: 'ｼｭｯｼｭｯ (起動音)',
	username: 'slackbot',
});

rtmClient.on('authenticated', (data) => {
	logger.info(`Logged in as ${data.self.name} of team ${data.team.name}`);
	webClient.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		text: '再接続しました',
		username: 'slackbot',
	});
});

rtmClient.start();
