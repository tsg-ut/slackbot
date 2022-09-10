import axios from 'axios';
import _logger from '../lib/logger';

const logger = _logger.child({bot: 'welcome'});

// https://scrapbox.io/help-jp/API
// https://scrapbox.io/scrapboxlab/%E3%82%B3%E3%83%BC%E3%83%89%E3%83%96%E3%83%AD%E3%83%83%E3%82%AF
const welcomeScrapboxUrl = `https://scrapbox.io/api/code/tsg/welcome/message`;

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

	return data;
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
