import axios from 'axios';
import logger from '../lib/logger';

// https://scrapbox.io/help-jp/API
const welcomeScrapboxUrl = `https://scrapbox.io/api/pages/tsg/welcome/text`;

const PrefixComment = '///';

import { WebClient } from '@slack/web-api';
import type { Member } from '@slack/web-api/dist/response/UsersListResponse';

import type { SlackInterface } from '../lib/slack';

async function extractWelcomeMessage(): Promise<string> {
	const { data } = await axios.get<any>(
		welcomeScrapboxUrl, {
		headers: {
			Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`,
		},
	});

	const body = data
		.split('\n')
		.slice(1)
		.filter((line: string) => !line.startsWith(PrefixComment))
		.join('\n');

	return body;
}

export default async ({ eventClient, webClient: slack }: SlackInterface) => {
	const postWelcomeMessage = async (slack: WebClient, channel: string, text: string) => {
		return slack.chat.postMessage({
			channel,
			text,
			link_names: true,
			icon_emoji: ':tsg:',
			username: 'TSG',
		});
	};

	eventClient.on('team_join', async ({ user }: { user: Member }) => {
		const userid = user.id;

		if (!userid) {
			return;
		}

		try {
			const message = await extractWelcomeMessage();
			await postWelcomeMessage(slack, userid, message);

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `Welcome <@${userid}> to TSG! :tada:`,
				icon_emoji: ':tsg:',
				username: 'welcome',
			});
		} catch (e) {
			logger.error('welcome error > ', e);

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `welcome for <@${userid}> error :cry:`,
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
