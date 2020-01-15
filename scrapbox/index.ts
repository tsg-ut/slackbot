import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {LinkUnfurls} from '@slack/client';
import qs from 'querystring';
import plugin from 'fastify-plugin';

const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;

import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	eventClient: any,
}

export default async ({rtmClient: rtm, webClient: slack, eventClient: event}: SlackInterface) => {
	event.on('link_shared', async (e: any) => {
		logger.info('Incoming unfurl request >');
		e.links.map((link: string) => logger.info('-', link));
		const links = e.links.filter(({domain}: {domain: string}) => domain === 'scrapbox.io');
		const unfurls: LinkUnfurls = {};
		for (const link of links) {
			const {url} = link;
			if (!(/^https?:\/\/scrapbox.io\/tsg\/.+/).test(url)) {
				continue;
			}
			let pageName = url.replace(/^https?:\/\/scrapbox.io\/tsg\/(.+)$/, '$1');
			try {
				if (decodeURI(pageName) === pageName) {
					pageName = encodeURI(pageName);
				}
			} catch {}
			const scrapboxUrl = getScrapboxUrl(pageName);
			const response = await axios.get(scrapboxUrl, {headers: {Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`}});
			const {data} = response;

			unfurls[url] = {
				title: data.title,
				title_link: url,
				author_name: 'Scrapbox',
				author_icon: 'https://scrapbox.io/favicon.ico',
				text: data.descriptions.join('\n'),
				color: '#484F5E',
				...(data.image ? {image_url: data.image} : {}),
			};
		}
		if (Object.values(unfurls).length > 0) {
			try {
				const {data} = await axios({
					method: 'POST',
					url: 'https://slack.com/api/chat.unfurl',
					data: qs.stringify({
						ts: e.message_ts,
						channel: e.channel,
						unfurls: JSON.stringify(unfurls),
						token: process.env.HAKATASHI_TOKEN,
					}),
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
					},
				});
				if (data.ok) {
					logger.info('✓ chat.unfurl >', data);
				} else {
					logger.info('✗ chat.unfurl >', data);
				}
			} catch (error) {
				logger.error('✗ chat.unfurl >', error);
			}
		} else {
			logger.info('No valid urls, skip.');
		}
	});
};


interface SlackAttachment {
	// WARN: incomplete
	title?: string;
	title_link?: string;
	text: string;
	mrkdwn_in?: string[];
	author_name?: string[]
}

interface SlackIncomingWebhookRequest {
	text: string;
	mrkdwn?: boolean;
	username?: string;
	attachments: SlackAttachment[]
}

const maskAttachment = (attachment: SlackAttachment): SlackAttachment => ({
	...attachment,
	text: 'この記事の更新通知はミュートされています。',
});

// eslint-disable-next-line node/no-unsupported-features, node/no-unsupported-features/es-syntax, padded-blocks
export const server = ({webClient: slack}: SlackInterface) => plugin((fastify, opts, next) => {

	/**
	 * Scrapboxからの更新通知 (Incoming Webhook形式) を受け取り，ミュート処理をしてSlackに投稿する
	 */

	fastify.post<unknown, unknown, unknown, SlackIncomingWebhookRequest>('/scrapbox', async (req, res) => {
		req.body;
		await slack.chat.postMessage(
			{
				channel: process.env.CHANNEL_SCRAPBOX,
				icon_emoji: ':scrapbox:',
				...req.body,
				attachments: req.body.attachments.map(
					(attachment) =>
						isMuted(attachment.title_link) ? maskAttachment(attachment) : attachment
				),
			}
		);
		return '';
	});

	next();
});

