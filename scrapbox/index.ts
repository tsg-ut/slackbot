import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {FastifyInstance} from 'fastify';
import {WebClient, RTMClient, LinkUnfurls} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;

export const server = ({webClient: slack}: SlackInterface) => async (fastify: FastifyInstance) => {
	fastify.post('/unfurl/scrapbox', async (req) => {
		if (!req.body) {
			return 'Not Implemented.';
		}

		switch (req.body.type) {
			case 'url_verification': {
				return req.body.challenge;
			}
			case 'event_callback': {
				logger.info('Incoming unfurl request >');
				req.body.event.links.map((link: string) => logger.info('-', link));
				const unfurls: LinkUnfurls = {};
				for (const link of req.body.event.links) {
					const { url, domain } = link;
					if (domain !== 'scrapbox.io') continue;
					if (!/^https?:\/\/scrapbox.io\/tsg\/.+/.test(url)) continue;
					let pageName = url.replace(/^https?:\/\/scrapbox.io\/tsg\/(.+)$/, '$1');
					try {
						if (decodeURI(pageName) === pageName) {
							pageName = encodeURI(pageName);
						}
					} catch {}
					const scrapboxUrl = getScrapboxUrl(pageName);
					const response = await axios.get(scrapboxUrl, { headers: { Cookie: `connect.sid=${process.env.SCRAPBOX_SID}` } });
					const data = response.data;

					unfurls[url] = {
						title: data.title,
						title_link: url,
						author_name: 'Scrapbox',
						author_icon: 'https://scrapbox.io/favicon.ico',
						text: data.descriptions.join('\n'),
						color: '#484F5E',
						...(data.image ? { image_url: data.image } : {}),
					};
				}
				if (Object.values(unfurls).length > 0) {
					try {
						const {data} = await axios.post('https://slack.com/api/chat.unfurl', {
							ts: req.body.event.message_ts,
							channel: req.body.event.channel,
							unfurls,
						}, {
							headers: {
								Authorization: `Bearer ${process.env.HAKATASHI_TOKEN}`,
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
			}
			default: {
				logger.info(`Unknown type "${req.body.type}"`);
				logger.info(req.body);
				break;
			}
		}
	});
};