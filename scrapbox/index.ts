import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {LinkUnfurls} from '@slack/client';
import qs from 'querystring';

const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;

import {WebClient, RTMClient} from '@slack/client';
// @ts-ignore
import {SlackEventAdapter} from '@slack/events-api';

interface SlackInterface {
	rtmClient: RTMClient,
		webClient: WebClient,
		eventClient: SlackEventAdapter,
}

export default async ({rtmClient: rtm, webClient: slack, eventClient: event}: SlackInterface) => {
	// @ts-ignore
	event.on('link_shared', async (e) => {
		logger.info('Incoming unfurl request >');
		e.links.map((link: string) => logger.info('-', link));
		// @ts-ignore
		const links = e.links.filter(({domain}) => domain === 'scrapbox.io');
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
		return 'Done.';
	});
};
