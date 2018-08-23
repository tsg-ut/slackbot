const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const schedule = require('node-schedule');
const {sortBy} = require('lodash');

class Counter {
    constructor(name) {
        this.name = name;
        this.map = new Map();
        this.load();
    }

    increment(key) {
        if (this.map.has(key)) {
            this.map.set(key, this.map.get(key) + 1);
        } else {
            this.map.set(key, 1);
        }

        this.save();
    }

    clear() {
        this.map = new Map();
    }

    entries() {
        const keys = Array.from(this.map.keys());
        const sortedKeys = sortBy(keys, (key) => this.map.get(key)).reverse();
        return sortedKeys.map((key) => [key, this.map.get(key)]);
    }

    async save() {
        const filePath = path.join(__dirname, `${this.name}.json`);
        await promisify(fs.writeFile)(filePath, JSON.stringify(Array.from(this.map.entries())));
    }

    async load() {
        const filePath = path.join(__dirname, `${this.name}.json`);

		const exists = await new Promise((resolve) => {
			fs.access(filePath, fs.constants.F_OK, (error) => {
				resolve(!Boolean(error));
			});
		});

		if (exists) {
			const data = await promisify(fs.readFile)(filePath);
            this.map = new Map(JSON.parse(data));
		} else {
            this.map = new Map();
        }
    }
}

module.exports = (clients) => {
    const { rtmClient: rtm, webClient: slack } = clients;

    const sushiCounter = new Counter('sushi');
    const suspendCounter = new Counter('suspend');

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
            sushiCounter.increment(user);
        }
        if (rtext.includes("ケーキ")) {
            slack.reactions.add({name: 'cake', channel, timestamp});
        }
        if (rtext.includes("殺") || rtext.includes("死")) {
            slack.reactions.add({name: 'no_good', channel, timestamp});
            slack.reactions.add({name: 'shaved_ice', channel, timestamp});
            suspendCounter.increment(user);
        }
        if (rtext.includes("akouryy")) {
            slack.reactions.add({name: 'no_good', channel, timestamp});
            slack.reactions.add({name: 'akouryy', channel, timestamp});
        }
    });

	schedule.scheduleJob('0 19 * * 0', async () => {
        const {members} = await slack.users.list();

        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: 'sushi-bot',
            text: '今週の凍結ランキング',
            icon_emoji: ':shaved_ice:',
            attachments: suspendCounter.entries().map(([user, count], index) => {
                const member = members.find(({id}) => id === user);
                const name = member.profile.display_name || member.name;

                return {
                    author_name: `${index + 1}位: ${name} (${count + 1}回)`,
                    author_icon: member.profile.image_24,
                };
            })
        });

        suspendCounter.clear();

        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: 'sushi-bot',
            text: '今週の寿司ランキング',
            icon_emoji: ':sushi:',
            attachments: sushiCounter.entries().map(([user, count], index) => {
                const member = members.find(({id}) => id === user);
                const name = member.profile.display_name || member.name;

                return {
                    author_name: `${index + 1}位: ${name} (${count + 1}回)`,
                    author_icon: member.profile.image_24,
                };
            })
        });

        sushiCounter.clear();
    });
};
