// Automatically removes join/leave messages in sandbox

import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message) => {
		if (message.channel === process.env.CHANNEL_SANDBOX) {
			if (message.subtype === 'channel_join' || message.subtype === 'channel_leave') {
				await slack.chat.delete({
					token: process.env.HAKATASHI_TOKEN,
					channel: message.channel,
					ts: message.ts,
				});
			}
		}
	});
};
