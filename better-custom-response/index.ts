import customResponses from './custom-responses';
import {sample, shuffle} from 'lodash';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';

interface SlackInterface {
    rtmClient: RTMClient,
    webClient: WebClient,
}

const response = (text:string) => {
    for (const resp of customResponses) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                if ({}.hasOwnProperty.call(resp, 'outputArray')) {
                    return [resp.shuffle ? shuffle(resp.outputArray).join('') : sample(resp.outputArray), resp.username, resp.icon_emoji];
                } else {
                    return [resp.outputFunction(matches), resp.username, resp.icon_emoji];
                }
            }
        }
    }
    return [null, null, null];
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    rtm.on('message', async (message) => {
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT') return;
        const {text} = message;
        if (!text) return;
        const resp = response(text);
        if (!resp[0]) return;
        const username = !resp[1] ? 'better-custom-response' : resp[1];
        const icon_emoji = !resp[2] ? 'atama' : resp[2];
        await slack.chat.postMessage({
            channel: message.channel,
            text: resp[0],
            username,
            icon_emoji,
        });
    });
}
