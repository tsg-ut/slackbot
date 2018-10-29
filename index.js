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
	require('./prime'),
];

const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
const webClient = new WebClient(process.env.SLACK_TOKEN);

for (const plugin of plugins) {
	plugin({rtmClient, webClient});
}

rtmClient.on('authenticated', (data) => {
	console.log(`Logged in as ${data.self.name} of team ${data.team.name}`);
});

rtmClient.start();
