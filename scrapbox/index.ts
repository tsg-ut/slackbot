import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import qs from 'querystring';
import plugin from 'fastify-plugin';
import {flatten, zip} from 'lodash';
import {WebClient, RTMClient, LinkUnfurls, MessageAttachment} from '@slack/client';
import {Page, getPageUrlRegExp} from '../lib/scrapbox';

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
				page = new Page({url});
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


interface ScrapboxPageNotification {
	main: MessageAttachment,
	sub: MessageAttachment[],
}

export const splitAttachments = (attachments: MessageAttachment[]): ScrapboxPageNotification[] => {
	const pageIndices = attachments
		.map(({title_link}, i) => ({url: title_link, i}))
		.filter(({url}) => getPageUrlRegExp({projectName: null}).test(url))
		.map(({i}) => i);
	const pageRange = zip(pageIndices, pageIndices.concat([attachments.length]).slice(1));
	return pageRange.map(([i, j]) => ({main: attachments[i], sub: attachments.slice(i + 1, j)}));
};

/**
 * ミュートしたい記事に対し，隠したい情報を消したattachmentsを生成
 *
 * @param notification ミュートしたい記事のattachmentと画像
 * @return ミュート済みのattachments
 */
export const maskAttachments = (notification: ScrapboxPageNotification): MessageAttachment[] => {
	const dummyText = 'この記事の更新通知はミュートされています。';
	return [{
		...notification.main,
		text: dummyText,
		fallback: dummyText,
		image_url: null,
		thumb_url: null,
	}];
};

/**
 * ミュートしたくない記事に対し，そのままattachments形式に変換
 *
 * @param notification 変換する記事のattachmentと画像
 * @return ミュート済みのattachments
 */
export const reconstructAttachments = (notification: ScrapboxPageNotification): MessageAttachment[] => [notification.main, ...notification.sub];

export const muteTag = '##ミュート';
const getMutedList = async (): Promise<Set<string>> => {
	const muteTagPage = new Page({titleLc: muteTag, isEncoded: false});
	return new Set((await muteTagPage.fetchInfo()).relatedPages.links1hop.map(({titleLc}) => titleLc));
};

interface SlackIncomingWebhookRequest {
	text: string;
	mrkdwn?: boolean;
	username?: string;
	attachments: MessageAttachment[];
}

/**
 * Scrapboxからの更新通知 (Incoming Webhook形式) を受け取り，ミュート処理をしてSlackに投稿する
 */
// eslint-disable-next-line node/no-unsupported-features, node/no-unsupported-features/es-syntax
export const server = ({webClient: slack}: SlackInterface) => plugin((fastify, opts, next) => {
	fastify.post<unknown, unknown, unknown, SlackIncomingWebhookRequest>('/hooks/scrapbox', async (req) => {
		const mutedList = await getMutedList();
		const attachments = flatten(
			splitAttachments(req.body.attachments).map(
				(notification) => mutedList.has(new Page({url: notification.main.title_link}).titleLc)
					? maskAttachments(notification)
					: reconstructAttachments(notification),
			),
		);
		await slack.chat.postMessage(
			{
				channel: process.env.CHANNEL_SCRAPBOX,
				icon_emoji: ':scrapbox:',
				...req.body,
				attachments,
			},
		);
		return '';
	});

	next();
});

