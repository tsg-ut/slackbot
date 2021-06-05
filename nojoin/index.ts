import {SlackInterface} from '../lib/slack';

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message: any) => {
		if (message.subtype === 'channel_join' || message.subtype === 'channel_leave') {
			await slack.chat.delete({
				token: process.env.HAKATASHI_TOKEN,
				channel: message.channel,
				ts: message.ts,
			});
		}
	});
};
