require('dotenv').config();

const {RtmClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');

const slack = new RtmClient(process.env.SLACK_TOKEN);

let channel = null;

slack.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (data) => {
	for (const c of data.channels) {
		if (c.is_member && c.name ==='general') {
			channel = c.id;
		}
	}
	console.log(`Logged in as ${data.self.name} of team ${data.team.name}, but not yet connected to a channel`);
});

slack.on(RTM_EVENTS.MESSAGE, (message) => {
	console.log(message);
});

slack.start();
