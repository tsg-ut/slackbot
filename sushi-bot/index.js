const { RTM_EVENTS } = require("@slack/client")

module.exports = (clients) => {
    const { rtmClient: rtm, webClient: slack } = clients;

    rtm.on(RTM_EVENTS.MESSAGE, async (message) => {
        const { channel, text, user, ts: timestamp } = message;
        if (!text) {
            return;
        }

        let rtext = text;
        rtext = rtext.
            replace(/鮨/g, 'すし').
            replace(/(su|ス|ズ|ず|寿|壽)/g, 'す').
            replace(/(si|shi|ci|し|シ|司)/g, 'し');
        rtext = rtext.
            replace(/akouryyy/g, 'akkoury').
            replace(/akouryy/g, '').
            replace(/kk/g, 'k').
            replace(/rr/g, 'r').
            replace(/y/g, 'yy');

        if (rtext.includes("すし")) {
            slack.reactions.add('sushi', {channel, timestamp});
        }
        if (rtext.includes("殺") || rtext.includes("死")) {
            slack.reactions.add('no_good', {channel, timestamp});
            slack.reactions.add('shaved_ice', {channel, timestamp});
        }
        if (rtext.includes("akouryy")) {
            slack.reactions.add('no_good', {channel, timestamp});
            slack.reactions.add('akouryy', {channel, timestamp});
        }
    });
};
