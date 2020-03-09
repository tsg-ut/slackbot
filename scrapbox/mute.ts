import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import plugin from 'fastify-plugin';
import {flatten, zip} from 'lodash';
// @ts-ignore
import {Page, pageUrlRegExp} from '../lib/scrapbox';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	eventClient: any,
}

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
	return pageRange.map(([i, j]) => ({
		text: attachments[i],
		images: attachments.slice(i + 1, j).map((a) => ({text: '', ...a})),
	}));
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
// for developers: 実際に動かすのは手間がかかるので，fastify.inject などで動作確認するのがおすすめです。mute.test.ts 参照

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
