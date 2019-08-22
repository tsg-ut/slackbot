import customResponses from "./custom-responses";
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import {Deferred} from '../lib/utils';

interface SlackInterface {
    rtmClient: RTMClient,
    webClient: WebClient,
    messageClient: any,
}

const loadDeferred = new Deferred();

const response = (text:string) => {
    const splittedText = text.replace(/ .,;:+\*<>?_}@\[`{]!"#\$%&'\(\)=~|-\^¥\\/g, ' ').split(' ');
    for (const part of splittedText) {
        for (const resp of customResponses) {
            for (const regexp of resp.input) {
                if (regexp.test(part)) {
                    if ({}.hasOwnProperty.call(resp, 'outputArray')) {
                        const resultNumber = Math.floor(Math.random() * resp.outputArray.length);
                        return resp.outputArray[resultNumber];
                    } else {
                        return resp.outputFunction(part);
                    }
                }
            }
        }
    }
    return null;
};

export default async ({rtmClient: rtm, webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
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
