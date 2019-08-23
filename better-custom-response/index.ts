import customResponses from './custom-responses';
import {sample, shuffle} from 'lodash';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import {Deferred} from '../lib/utils';

interface SlackInterface {
    rtmClient: RTMClient,
    webClient: WebClient,
}

const loadDeferred = new Deferred();

const response = (text:string) => {
    for (const resp of customResponses) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                if ({}.hasOwnProperty.call(resp, 'outputArray')) {
                    return resp.shuffle ? shuffle(resp.outputArray).join('') : sample(resp.outputArray);
                } else {
                    return resp.outputFunction(matches);
                }
            }
        }
    }
    return null;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    loadDeferred.resolve(slack);

    rtm.on('message', async (message) => {
        const {text} = message;
        if (!text) return;
        const resp = response(text);
        if (!resp) return;
        await slack.chat.postMessage({
            channel: message.channel,
            text: resp,
        });
    });
}
