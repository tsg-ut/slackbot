import axios from 'axios';
import logger from '../lib/logger';

// https://scrapbox.io/help-jp/API
const welcomeScrapboxUrl = `https://scrapbox.io/api/pages/tsg/welcome/text`;

import { WebClient } from '@slack/web-api';
import type { SlackInterface } from '../lib/slack';

async function extractWelcomeMessage(): Promise<string> {
	const { data } = await axios.get<any>(
		welcomeScrapboxUrl, {
		headers: {
			Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`,
		},
	});

	const body = data.split('\n').slice(1).join('\n');

	return body;
}

export default async ({ eventClient, webClient: slack }: SlackInterface) => {
	const general = await slack.conversations.list({ exclude_archived: true, limit: 1000 })
		.then((list: any) => list.channels.find(({ is_general }: { is_general: boolean }) => is_general).id);

	const postWelcomeMessage = async (slack: WebClient, channel: string, body: string) => {
		return slack.chat.postMessage({
			channel,
			body,
			link_names: true,
			icon_emoji: ':tsg:',
			username: 'TSG',
		});
	};

	eventClient.on('team_join', async ({ user }: any) => {
		// FIXME:
		//   This event should be used instead of member_joined_channel with channel value condition
		//   cf. https://api.slack.com/events/team_join
		logger.info(`welcome:team_join: ${JSON.stringify(user)}`);
	});

	eventClient.on('member_joined_channel', async ({ channel, user }: any) => {
		if (channel !== general) {
			return;
		}

		if (!user) {
			return;
		}

		try {
			const message = await extractWelcomeMessage();
			await postWelcomeMessage(slack, user, message);

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `Welcome <@${user}> to TSG! :tada:`,
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

	eventClient.on('message', async ({ channel, text }: { channel: string, text: string }) => {
		// preview mode

		if (!channel || !text) {
			return;
		}

		if (channel.startsWith('D') && text.trim() === 'welcome') {
			const message = await extractWelcomeMessage();
			await postWelcomeMessage(slack, channel, message);
		}
	});
};
