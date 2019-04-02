const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const schedule = require('node-schedule');
const {sortBy} = require('lodash');
const moment = require('moment');
const {unlock} = require('../achievements');

class Counter {
    constructor(name) {
        this.name = name;
        this.map = new Map();
        this.load();
    }

    add(key, cnt = 1) {
        if (this.map.has(key)) {
            this.map.set(key, this.map.get(key) + cnt);
        } else {
            this.map.set(key, cnt);
        }

        this.save();
    }

    clear() {
        this.map = new Map();
        this.save();
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

function count(haystack, needle) {
    return haystack.split(needle).length - 1;
}

function numToEmoji(num) {
    switch(num) {
        case 0:
            return 'zero';
        case 1:
            return 'one';
        case 2:
            return 'two';
        case 3:
            return 'three';
        case 4:
            return 'four';
        case 5:
            return 'five';
        case 6:
            return 'six';
        case 7:
            return 'seven';
        case 8:
            return 'eight';
        case 9:
            return 'nine';
        case 10:
            return 'keycap_ten';
        default:
            return 'vsonline';
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
            replace(/(sh?i|ci|し|シ|司|\u{0328})/giu, 'し');

        rtext = rtext.
            replace(/(ca|(ke|け|ケ)(i|ぃ|い|ｨ|ィ|ｲ|イ|e|ぇ|え|ｪ|ェ|ｴ|エ|-|ー))(ki|ke|き|キ)/gi, 'ケーキ');

        rtext = rtext.
            replace(/akouryyy/gi, 'akkoury').
            replace(/akouryy/gi, '').
            replace(/kk/gi, 'k').
            replace(/rr/gi, 'r').
            replace(/y/gi, 'yy');

        if (count(rtext, 'すし')) {
            const cnt = count(rtext, 'すし');
            await slack.reactions.add({name: 'sushi', channel, timestamp});
            if (channel.startsWith('C')) {
                unlock(user, 'get-sushi');
                if (moment().utcOffset(9).date() === 3) {
                    unlock(user, 'wednesday-sushi');
                }
            }
            if(cnt >= 2) {
                if (channel.startsWith('C')) {
                    unlock(user, 'get-multiple-sushi');
                    if (cnt > 10) {
                        unlock(user, 'get-infinite-sushi');
                    }
                }
                await slack.reactions.add({name: 'x', channel, timestamp});
                await slack.reactions.add({name: numToEmoji(cnt), channel, timestamp});
            }
            sushiCounter.add(user, cnt);
        }
        if (rtext.includes("ケーキ")) {
            slack.reactions.add({name: 'cake', channel, timestamp});
        }
        if (rtext.includes("殺") || rtext.includes("死")) {
            const cnt = count(rtext, '殺') + count(rtext, '死');
            if (channel.startsWith('C')) {
                unlock(user, 'freezing');
            }
            await slack.reactions.add({name: 'no_good', channel, timestamp});
            await slack.reactions.add({name: 'cookies146', channel, timestamp});
            if(cnt >= 2) {
                await slack.reactions.add({name: 'x', channel, timestamp});
                await slack.reactions.add({name: numToEmoji(cnt), channel, timestamp});
            }
            suspendCounter.add(user, cnt);
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
            icon_emoji: ':cookies146:',
            attachments: suspendCounter.entries().map(([user, count], index) => {
                const member = members.find(({id}) => id === user);
                if (!member) {
                    return null;
                }
                const name = member.profile.display_name || member.name;
                if (index === 0) {
                    unlock(user, 'freezing-master');
                }

                return {
                    author_name: `${index + 1}位: ${name} (${count}回)`,
                    author_icon: member.profile.image_24,
                };
            }).filter((attachment) => attachment !== null),
        });

        suspendCounter.clear();

        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: 'sushi-bot',
            text: '今週の寿司ランキング',
            icon_emoji: ':sushi:',
            attachments: sushiCounter.entries().map(([user, count], index) => {
                const member = members.find(({id}) => id === user);
                if (!member) {
                    return null;
                }
                const name = member.profile.display_name || member.name;

                return {
                    author_name: `${index + 1}位: ${name} (${count}回)`,
                    author_icon: member.profile.image_24,
                };
            }).filter((attachment) => attachment !== null),
        });

        sushiCounter.clear();
    });
};
