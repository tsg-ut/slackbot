require('dotenv').config();

process.on('unhandledRejection', (error) => {
	console.error(error);
});

const {RtmClient, WebClient, CLIENT_EVENTS} = require('@slack/client');

const plugins = [
	require('./mahjong')
];

const rtmClient = new RtmClient(process.env.SLACK_TOKEN);
const webClient = new WebClient(process.env.SLACK_TOKEN);

for (const plugin of plugins) {
	plugin({rtmClient, webClient});
}

rtmClient.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (data) => {
	console.log(`Logged in as ${data.self.name} of team ${data.team.name}`);
});

rtmClient.start();
