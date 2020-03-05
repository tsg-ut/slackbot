import qs from 'querystring';
import {WebClient, RTMClient, LinkUnfurls} from '@slack/client';
import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {Page, tsgProjectName} from '../lib/scrapbox';

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
