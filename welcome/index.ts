import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';

const welcomeScrapboxUrl = `https://scrapbox.io/api/pages/tsg/welcome`;

import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
		webClient: WebClient,
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const general = await slack.conversations.list({exclude_archived: true, limit: 1000})
		.then((list: any) => list.channels.find(({is_general}: {is_general: boolean}) => is_general).id);

	rtm.on('team_join', async ({user}: any) => {
		if (!user.id) {
			return;
		}

		try {
			const {data} = await axios.get(welcomeScrapboxUrl, {headers: {Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`}});
			const text = data.lines.map(({text}: {text: string}) => text).slice(1).join('\n');

			await slack.chat.postMessage({
				channel: user.id,
				text,
				link_names: true,
				icon_emoji: ':jp3bgy:',
				username: 'JP3BGY',
			});

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `welcome for <@${user.id}> done :heavy_check_mark:`,
				icon_emoji: ':tsg:',
				username: 'welcome',
			});
		} catch (e) {
			logger.error('welcome error > ', e);

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `welcome for <@${user.id}> error :cry:`,
				icon_emoji: ':exclamation:',
				username: 'welcome',
			});
		}
	});
};
