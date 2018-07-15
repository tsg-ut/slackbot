module.exports = (clients) => {
    const { rtmClient: rtm, webClient: slack } = clients;

    rtm.on('message', async (message) => {
        const { channel, text, user, ts: timestamp } = message;
        if (!text) {
            return;
        }

        let rtext = text;
        rtext = rtext.
            replace(/鮨/g, 'すし').
            replace(/(su|zu|ス|ズ|ず|寿|壽)/gi, 'す').
            replace(/(sh?i|ci|し|シ|司)/gi, 'し');

        rtext = rtext.
            replace(/(ca|(ke|け|ケ)(i|ぃ|い|ｨ|ィ|ｲ|イ|e|ぇ|え|ｪ|ェ|ｴ|エ|-|ー))(ki|ke|き|キ)/gi, 'ケーキ');

        rtext = rtext.
            replace(/akouryyy/gi, 'akkoury').
            replace(/akouryy/gi, '').
            replace(/kk/gi, 'k').
            replace(/rr/gi, 'r').
            replace(/y/gi, 'yy');

        if (rtext.includes("すし")) {
            slack.reactions.add({name: 'sushi', channel, timestamp});
        }
        if (rtext.includes("ケーキ")) {
            slack.reactions.add({name: 'cake', channel, timestamp});
        }
        if (rtext.includes("殺") || rtext.includes("死")) {
            slack.reactions.add({name: 'no_good', channel, timestamp});
            slack.reactions.add({name: 'shaved_ice', channel, timestamp});
        }
        if (rtext.includes("akouryy")) {
            slack.reactions.add({name: 'no_good', channel, timestamp});
            slack.reactions.add({name: 'akouryy', channel, timestamp});
        }
    });
};
