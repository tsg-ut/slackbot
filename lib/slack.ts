import {RTMClient, WebClient} from '@slack/client';

export const rtmClient = new RTMClient(process.env.SLACK_TOKEN);
export const webClient = new WebClient(process.env.SLACK_TOKEN);
