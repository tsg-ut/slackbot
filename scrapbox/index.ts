import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import qs from 'querystring';
import plugin from 'fastify-plugin';
import {WebClient, RTMClient, LinkUnfurls, MessageAttachment} from '@slack/client';
import {Page} from '../lib/scrapbox';

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
			let page: Page | null = null;
			try {
				page = new Page({ url });
			} catch {
				continue;
			}
			const data = await page.fetchInfo();

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


interface SlackIncomingWebhookRequest {
	text: string;
	mrkdwn?: boolean;
	username?: string;
	attachments: MessageAttachment[];
}

/**
 * ミュートしたいattachmentに対し，隠したい情報を消して返す
 *
 * @param attachment ミュートするattachment
 * @return ミュート済みのattachment
 */
const maskAttachment = (attachment: MessageAttachment): MessageAttachment => {
	const dummyText = 'この記事の更新通知はミュートされています。';
	return {
		...attachment,
		text: dummyText,
		fallback: dummyText,
		image_url: null,
		thumb_url: null,
	};
};

export const muteTag = '##ミュート';
const getMutedList = async (): Promise<Set<string>> => {
	const muteTagPage = new Page({ titleLc: muteTag, isEncoded: false });
	return new Set((await muteTagPage.fetchInfo()).relatedPages.links1hop.map(({ titleLc }) => titleLc));
};

/**
 * Scrapboxからの更新通知 (Incoming Webhook形式) を受け取り，ミュート処理をしてSlackに投稿する
 */
// eslint-disable-next-line node/no-unsupported	-features, node/no-unsupported-features/es-syntax
export const server = ({webClient: slack}: SlackInterface) => plugin((fastify, opts, next) => {
	fastify.post<unknown, unknown, unknown, SlackIncomingWebhookRequest>('/hooks/scrapbox', async (req) => {
		const mutedList = await getMutedList();
		await slack.chat.postMessage(
			{
				channel: process.env.CHANNEL_SCRAPBOX,
				icon_emoji: ':scrapbox:',
				...req.body,
				attachments: await Promise.all(req.body.attachments.map(
					async (attachment) => await mutedList.has(new Page({ url: attachment.title_link }).titleLc) ? maskAttachment(attachment) : attachment,
				)),
			},
		);
		return '';
	});

	next();
});

