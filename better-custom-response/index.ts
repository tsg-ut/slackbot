import localResponses from './custom-responses';
import {sample, shuffle} from 'lodash';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import {getCustomResponses as getWebResponses} from './server';

interface SlackInterface {
    rtmClient: RTMClient,
    webClient: WebClient,
}

const getCustomResponses = () => localResponses.concat(Array.from(getWebResponses()));

const response = (text:string) => {
    for (const resp of getCustomResponses().filter((response) => !response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            // TODO: ReDoSを防ぐため，別スレッドを立ててTLEしたらterminateする
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : resp.outputFunction(matches);
                if (!responses) continue;
                return [resp.shuffle ? shuffle(responses).join('') : sample(responses), resp.username, resp.icon_emoji];
            }
        }
    }
    return [null, null, null];
};

const reaction = (text:string) => {
    for (const resp of getCustomResponses().filter((response) => response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : resp.outputFunction(matches);
                if (!responses) continue;
                return resp.shuffle ? shuffle(responses) : [sample(responses)];
            }
        }
    }
    return null;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    rtm.on('message', async (message) => {
        if(message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT') return;
        const {channel, text, ts: timestamp} = message;
        if (!text) return;
        const resp = response(text);
        if (resp[0]) {
            const username = !resp[1] ? '(Web) better-custom-response' : resp[1];
            const icon_emoji = !resp[2] ? ':pizzacat83:' : resp[2];
            await slack.chat.postMessage({
                channel: message.channel,
                text: resp[0],
                username,
                icon_emoji,
            });
        }
        const reac = reaction(text);
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
