import qs from 'querystring';
import type {LinkUnfurls} from '@slack/web-api';
import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import type {SlackInterface} from '../lib/slack';

const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;

interface Link {
	url: string;
	domain: string; // e.g. scrapbox.io
}

interface ScrapboxUser {
	id: string;
	name: string;
	displayName: string;
	photo: string; // URL
}

interface ScrapboxLine {
	id: string;
	text: string;
	userId: string;
	created: number;
	updated: number;
}

interface ScrapboxPage {
	id: string;
	title: string;
	image: string; // URL
	descriptions: string[];
	user: ScrapboxUser;
	pin: number;
	views: number;
	linked: number;
	commitId: string;
	created: number;
	updated: number;
	accessed: number;
	snapshotCreated: number;
	persistent: boolean;
	lines: ScrapboxLine[];
}

export const scrapbox2slack = (s: string) => (
	s.replace(/\[(https?:\/\/.+)\]/g, '$1') // 外部リンク
		.replace(/\[([^\[\]]+).icon\]/g, '<https://scrapbox.io/tsg/$1|$1>') // アイコンリンク
		.replace(/#([^\s]*)/g, '<https://scrapbox.io/tsg/$1|#$1>') // hashtag (TSG独自記法)
		.replace(/\[([^\s\*\[\]]+)\]/g, '<https://scrapbox.io/tsg/$1|$1>') // Scrapbox記事リンク
		.replace(/\[([^\*]*)+\s([^\s\]]+)\]/g, '<$2|$1>') // 文字を指定するタイプのリンク
		.replace(/\[\*+ ([^\[\]]*)]/g, '*$1*') // 太字
	// バグあるかも。誰かよろしく!
);

export default async ({rtmClient: rtm, webClient: slack, eventClient: event}: SlackInterface) => {
	event.on('link_shared', async (e: { links: Link[]; message_ts: string; channel: string; }) => {
		logger.info('Incoming unfurl request >');
		for (const link of e.links) {
			logger.info('-', link);
		}
		const links = e.links.filter(({domain}) => domain === 'scrapbox.io');
		const unfurls: LinkUnfurls = {};
		for (const link of links) {
			const {url} = link;
			if (!(/^https?:\/\/scrapbox.io\/tsg\/.+/).test(url)) {
				continue;
			}
			let [_, pageName, __, lineId] = url.match(/^https?:\/\/scrapbox.io\/tsg\/([^#]+)(#([\da-f]+))?$/);
			// 型定義がカスで、lineId は string と思われてるが本当は string | undefined.
			try {
				if (decodeURI(pageName) === pageName) {
					pageName = encodeURI(pageName);
				}
			} catch {}
			const scrapboxUrl = getScrapboxUrl(pageName);
			const response = await axios.get<ScrapboxPage>(scrapboxUrl, {headers: {Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`}});
			const {data} = response;
			const lineIndex = data.lines.map((line) => line.id).indexOf(lineId);
			const rawDescriptions = lineId ? data.lines.filter((d, i) => i >= lineIndex)
				.slice(0, 5) // descriptions と同じ個数
				.map((line) => line.text) : data.descriptions;
			const descriptions = rawDescriptions.map((d) => scrapbox2slack(d));

			unfurls[url] = {
				title: data.title,
				title_link: url,
				author_name: 'Scrapbox',
				author_icon: 'https://scrapbox.io/favicon.ico',
				text: descriptions.join('\n'),
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
