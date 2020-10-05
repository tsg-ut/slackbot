import customResponses from './custom-responses';
import responseAchievements from './response-achievements';
import {sample, shuffle} from 'lodash';
import type {SlackInterface} from '../lib/slack';
const {unlock} = require('../achievements');


const response = async (text:string) => {
    for (const resp of customResponses.filter((response) => !response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches);
                if (!responses) continue;
                return [resp.shuffle ? shuffle(responses).join('') : sample(responses), resp.username, resp.icon_emoji];
            }
        }
    }
    return [null, null, null];
};

const reaction = async (text:string) => {
    for (const resp of customResponses.filter((response) => response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches);
                if (!responses) continue;
                return resp.shuffle ? shuffle(responses) : [sample(responses)];
            }
        }
    }
    return null;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    rtm.on('message', async (message) => {
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT') return;
        const {channel, text, ts: timestamp} = message;
        if (!text) return;
        const resp = await response(text);
        if (resp[0]) {
            const username = !resp[1] ? 'better-custom-response' : resp[1];
            const icon_emoji = !resp[2] ? ':slack:' : resp[2];
            await slack.chat.postMessage({
                channel: message.channel,
                text: resp[0],
                username,
                icon_emoji,
            });
            for (const achieve of responseAchievements) {
                for (const regexp of achieve.trigger) {
                    const matches = resp[0].match(regexp);
                    if (matches !== null) {
                        await unlock(message.user, achieve.name);
                    }
                }
            }
        }
        const reac = await reaction(text);
        if (!reac) return;
        for (const reaction of reac) {
            try {
                await slack.reactions.add({name: reaction, channel, timestamp});
            } catch (e) {
                if(e.data.error !== "already_reacted")throw e;
            }
        }
    });
}
