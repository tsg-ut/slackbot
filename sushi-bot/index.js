const request = require("request");
const emoji = require("node-emoji");

const { RTM_EVENTS } = require("@slack/client")

module.exports = (clients) => {
	const { rtmClient: rtm, webClient: slack } = clients;

	rtm.on(RTM_EVENTS.MESSAGE, async (message) => {
		if (message.subtype) {
			return;
		}
		const { channel, text, user, ts: timestamp } = message;
        if (text.includes("すし")) {
            slack.reactions.add('sushi', {channel, timestamp});
        }
	});
};
