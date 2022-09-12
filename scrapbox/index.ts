import qs from 'querystring';
import type {LinkUnfurls} from '@slack/web-api';
import axios, {AxiosResponse} from 'axios';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';

const log = logger.child({bot: 'scrapbox'});

const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;

interface Link {
	url: string,
	domain: string, // e.g. scrapbox.io
}

interface ScrapboxUser {
	id: string,
	name: string,
	displayName: string,
	photo: string, // URL
}

interface ScrapboxLine {
	id: string,
	text: string,
	userId: string,
	created: number,
	updated: number,
}

interface ScrapboxPage {
	id: string,
	title: string,
	image: string, // URL
	descriptions: string[],
	user: ScrapboxUser,
	pin: number,
	views: number,
	linked: number,
	commitId: string,
	created: number,
	updated: number,
	accessed: number,
	snapshotCreated: number,
	persistent: boolean,
	lines: ScrapboxLine[],
}

export const scrapbox2slack = (s: string) => (
	s.replace(/\[(?<url>https?:\/\/.+?)\]/g, '$<url>') // 外部リンク
		.replace(/\[(?<username>[^[\]]+).icon\]/g, '<https://scrapbox.io/tsg/$<username>|$<username>>') // アイコンリンク
		.replace(/\[(?<str>(?!\*).+?)\s(?<href>https?:\/\/.+?)\]/g, '<$<href>|$<str>>') // 文字を指定するタイプのリンク
		.replace(/\[(?<title>(?!\*).+?)\]/g, '<https://scrapbox.io/tsg/$<title>|$<title>>') // Scrapbox記事リンク
		.replace(/\[\*+ (?<str>.+?)]/g, '*$<str>*') // 太字
		.replace(/(?<!\/|\|)#(?<hashtag>[^\s]+)/g, '<https://scrapbox.io/tsg/$<hashtag>|#$<hashtag>>') // hashtag
);

export default ({webClient: slack, eventClient: event}: SlackInterface) => {
	event.on('link_shared', async ({links, message_ts, channel}: { links: Link[]; message_ts: string; channel: string; }) => {
		log.info('Incoming unfurl request', {links});

		const scrapboxLinks = links.filter(({domain}) => domain === 'scrapbox.io');
		const unfurls: LinkUnfurls = {};
		for (const link of scrapboxLinks) {
			const {url} = link;
			const urlRe = new RegExp(/^https?:\/\/scrapbox.io\/tsg\/(?<pageName>#?[^#]+)(?<hash>#(?<lineId>[\da-f]+))?$/);
			if (!(urlRe).test(url)) {
				continue;
			}
			const {groups} = url.match(urlRe);
			let {pageName} = groups;
			const {lineId} = groups; // 型定義がカスで、string と思われてるが本当は string | undefined.
			try {
				if (decodeURI(pageName) === pageName) {
					pageName = encodeURI(pageName);
				}
			} catch {
				//
			}
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
				const data = await slack.chat.unfurl({
					ts: message_ts,
					channel,
					unfurls,
				});
			} catch (error) {
				log.error('chat.unfurl', {error});
			}
		} else {
			log.info('No valid urls, skip.');
		}
	});
};
