const request = require("request");
const emoji = require("node-emoji");

const { RTM_EVENTS } = require("@slack/client")

module.exports = (clients) => {
    const { rtmClient: rtm, webClient: slack } = clients;

    rtm.on(RTM_EVENTS.MESSAGE, async (message) => {
        const { channel, text, user, ts: timestamp } = message;
        if (!text) {
            return;
        }

        const rtext = text.
            replace(/鮨/g, 'すし').
            replace(/(su|ス|ズ|ず|寿|壽)/g, 'す').
            replace(/(si|shi|ci|し|シ|司)/g, 'し');

        if (rtext.includes("すし")) {
            slack.reactions.add('sushi', {channel, timestamp});
        }
    });
};
