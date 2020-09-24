import axios from 'axios';
import {WebClient} from '@slack/client';
// @ts-ignore
import logger from '../lib/logger.js';

import {Page} from '../lib/scrapbox';
import type {SlackInterface} from '../lib/slack';

async function postWelcomeMessage(slack: WebClient, channel: string) {
	const welcomePage = new Page({ titleLc: 'welcome', isEncoded: false });
	const text = (await welcomePage.fetchInfo()).lines.map(({text}: {text: string}) => text).slice(1).join('\n');

	return slack.chat.postMessage({
		channel,
		text,
		link_names: true,
		icon_emoji: ':tsg:',
		username: 'TSG',
	});
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const general = await slack.conversations.list({exclude_archived: true, limit: 1000})
		.then((list: any) => list.channels.find(({is_general}: {is_general: boolean}) => is_general).id);

	rtm.on('member_joined_channel', async ({channel, user}: any) => {
		if (channel !== general) {
			return;
		}

		if (!user) {
			return;
		}

		try {
			await postWelcomeMessage(slack, user);

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `welcome for <@${user}> done :heavy_check_mark:`,
				icon_emoji: ':tsg:',
				username: 'welcome',
			});
		} catch (e) {
			logger.error('welcome error > ', e);

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `welcome for <@${user}> error :cry:`,
				icon_emoji: ':exclamation:',
				username: 'welcome',
			});
		}
	});

	rtm.on('message', async ({channel, text}) => {
		// preview mode

		if (!channel || !text) {
			return;
		}

		if (channel.startsWith('D') && text.trim() === 'welcome') {
			postWelcomeMessage(slack, channel);
		}
	});
};
