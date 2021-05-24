import customResponses from './custom-responses';
import type {Context} from './custom-responses';
import {sample, shuffle} from 'lodash';
import type {SlackInterface} from '../lib/slack';
const {unlock} = require('../achievements');

const response = async (text: string, context: Context) => {
    for (const resp of customResponses.filter((response) => !response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches, context);
                if (!responses) continue;
                const respText = resp.shuffle ? shuffle(responses).join('') : sample(responses);
                const respAchievements: string[] = [];
                if (resp.achievements) {
                    for (const achieve of resp.achievements) {
                        for (const trigger of achieve.trigger){
                            const achieveMatches = respText.match(trigger);
                            if (achieveMatches !== null) {
                                respAchievements.push(achieve.name);
                            }
                        }
                    }
                }
                return {text: respText, username: resp.username, icon_emoji: resp.icon_emoji, achievements: respAchievements};
            }
        }
    }
    return null;
};

const reaction = async (text: string, context: Context) => {
    for (const resp of customResponses.filter((response) => response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches, context);
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
        const {channel, text, ts: timestamp, user} = message;
        if (!text) return;
        const context: Context = {user};
        const resp = await response(text, context);
        if (resp) {
            const username = !resp.username ? 'better-custom-response' : resp.username;
            const icon_emoji = !resp.icon_emoji ? ':slack:' : resp.icon_emoji;
            await slack.chat.postMessage({
                channel: message.channel,
                text: resp.text,
                username,
                icon_emoji,
            });
            for (const achievementID of resp.achievements) {
                await unlock(message.user, achievementID);
            }
        }
        const reac = await reaction(text, context);
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
