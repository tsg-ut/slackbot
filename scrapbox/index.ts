import qs from 'querystring';
import {WebClient, RTMClient, LinkUnfurls, MessageAttachment} from '@slack/client';
import axios from 'axios';
import plugin from 'fastify-plugin';
import {flatten, zip} from 'lodash';
// @ts-ignore
import logger from '../lib/logger.js';
import {Page, pageUrlRegExp, tsgProjectName} from '../lib/scrapbox';

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
			if (page.projectName !== tsgProjectName) {
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

/**
 * 1つのScrapbox記事に関する通知を表すオブジェクト
 * @property text: 文章の更新についてのattachment
 * @property images: 添付画像のattachment[]
 */
interface ScrapboxPageNotification {
	text: MessageAttachment,
	images: MessageAttachment[],
}

/**
 * Scrapboxからの通知attachments全体を記事ごとに分け，通知オブジェクトに変換
 * @param attachments: 複数の記事に関するattachments
 * @returns 通知オブジェクトの配列
 */
export const splitAttachments = (attachments: MessageAttachment[]): ScrapboxPageNotification[] => {
	const pageIndices = attachments
		.map(({title_link}, i) => ({url: title_link, i}))
		.filter(({url}) => pageUrlRegExp.test(url))
		.map(({i}) => i);
	const pageRange = zip(pageIndices, pageIndices.concat([attachments.length]).slice(1));
	return pageRange.map(([i, j]) => ({text: attachments[i], images: attachments.slice(i + 1, j)}));
};

/**
 * ミュートしたい記事に対し，隠したい情報を消したattachmentsを生成
 * 文章の更新は一部を隠した上で返し，画像の更新は全て消す
 * @param notification ミュートしたい記事の通知オブジェクト
 * @return ミュート済みのattachments
 */
export const maskAttachments = (notification: ScrapboxPageNotification): MessageAttachment[] => {
	const dummyText = 'この記事の更新通知はミュートされています。';
	return [{
		...notification.text,
		text: dummyText,
		fallback: dummyText,
		image_url: null,
		thumb_url: null,
	}];
};

/**
 * 記事の通知オブジェクトをそのままattachments形式に変換
 * @param notification 変換する記事の通知オブジェクト
 * @return 変換されたattachments
 */
export const reconstructAttachments = (notification: ScrapboxPageNotification): MessageAttachment[] => [notification.text, ...notification.images];

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
				(notification) => mutedList.has(new Page({url: notification.text.title_link}).titleLc)
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

