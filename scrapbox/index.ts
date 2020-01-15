import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {LinkUnfurls} from '@slack/client';
import qs from 'querystring';
import plugin from 'fastify-plugin';

const scrapboxUrlRegexp = /^https?:\/\/scrapbox.io\/tsg\/(.+)$/;
const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;
const getScrapboxUrlFromPageUrl = (url: string): string => {
	let pageName = url.replace(scrapboxUrlRegexp, '$1');
	try {
		if (decodeURI(pageName) === pageName) {
			pageName = encodeURI(pageName);
		}
	} catch {}
	return getScrapboxUrl(pageName);
};

import {WebClient, RTMClient, MessageAttachment} from '@slack/client';

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
			if (!scrapboxUrlRegexp.test(url)) {
				continue;
			}
			const scrapboxUrl = getScrapboxUrlFromPageUrl(url);
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

/**
 * 指定したURLの記事がミュート対象かどうかを判定する
 *
 * @param url Scrapbox記事のURL
 * @return ミュート対象ならtrue, 対象外ならfalse
 */
const isMuted = async (url: string): Promise<boolean> => {
	if (!scrapboxUrlRegexp.test(url)) {
		// this url is not a scrapbox page
		return false;
	}
	const muteTag = '##ミュート';
	const infoUrl = getScrapboxUrlFromPageUrl(url);
	const pageInfo = await axios.get(infoUrl, {headers: {Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`}});
	return pageInfo.data.links.indexOf(muteTag) !== -1; // if found, the page is muted
};

/**
 * Scrapboxからの更新通知 (Incoming Webhook形式) を受け取り，ミュート処理をしてSlackに投稿する
 */
// eslint-disable-next-line node/no-unsupported-features, node/no-unsupported-features/es-syntax
export const server = ({webClient: slack}: SlackInterface) => plugin((fastify, opts, next) => {
	fastify.post<unknown, unknown, unknown, SlackIncomingWebhookRequest>('/scrapbox', async (req, res) => {
		req.body;
		await slack.chat.postMessage(
			{
				channel: process.env.CHANNEL_SCRAPBOX,
				icon_emoji: ':scrapbox:',
				...req.body,
				attachments: await Promise.all(req.body.attachments.map(
					async (attachment) => await isMuted(attachment.title_link) ? maskAttachment(attachment) : attachment
				)),
			}
		);
		return '';
	});

	next();
});

