import axios from 'axios';

const welcomeScrapboxUrl = `https://scrapbox.io/api/pages/tsg/welcome`;

import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const general = await slack.conversations.list({exclude_archived: true, limit: 1000})
		.then((list: any) => list.channels.find(({is_general}: {is_general: boolean}) => is_general).id);

	rtm.on('member_joined_channel', async (event: any) => {
		if (event.channel !== general) {
			return;
		}

		const {data} = await axios.get(welcomeScrapboxUrl, {headers: {Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`}});
		const text = [`<@${event.user}>`, ...data.lines.map(({text}: {text: string}) => text).slice(1)].join('\n');
		slack.chat.postMessage({channel: process.env.CHANNEL_SANDBOX, text, link_names: true});
	});
};
