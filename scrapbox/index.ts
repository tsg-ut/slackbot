import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {FastifyInstance} from 'fastify';
import {LinkUnfurls} from '@slack/client';
import qs from 'querystring';

const getScrapboxUrl = (pageName: string) => `https://scrapbox.io/api/pages/tsg/${pageName}`;

// slack-log
const slacklogAPIDomain = 'localhost:9292';
const slacklogURLRegexp = RegExp('^https?://slack-log.tsg.ne.jp/([A-Z0-9]+)/([0-9]+\.[0-9]+)');
const getAroundMessagesUrl = (channel: string) => `http://${slacklogAPIDomain}/around_messages/${channel}.json`;

export const server = () => async (fastify: FastifyInstance) => {
	// slack-log
	const users = await axios.get(`http://${slacklogAPIDomain}/users.json`).then(({data}) => data);
	const channels = await axios.get(`http://${slacklogAPIDomain}/channels.json`).then(({data}) => data);

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
					const {url, domain} = link;
					switch (domain) {
						case 'scrapbox.io':
						{
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
							break;
						}
						case 'slack-log.tsg.ne.jp':
						{
							if (!slacklogURLRegexp.test(url)) {
								continue;
							}

							const [_, chanid, ts] = slacklogURLRegexp.exec(url);

							const aroundMessagesUrl = getAroundMessagesUrl(chanid);
							const response = await axios.post(aroundMessagesUrl, qs.stringify({ts}));
							// @ts-ignore
							const message = response.data.messages.find((m) => m.ts === ts);
							if (!message) {
								continue;
							}
							const {text, user: userid} = message;
							const user = userid && users[userid];
							const username = user && user.name;
							const channel = chanid && channels[chanid];
							const channame = channel && channel.name;
							const imageUrl = user && user.profile && (user.profile.image_original || user.profile.image_512);

							unfurls[url] = {
								color: '#4D394B',
								author_name: username || userid,
								author_icon: imageUrl || ':void:',
								text,
								footer: `Posted in #${channame || `<${channel}>`}`,
								ts,
							};
							break;
						}
					}
				}
				if (Object.values(unfurls).length > 0) {
					try {
						const {data} = await axios({
							method: 'POST',
							url: 'https://slack.com/api/chat.unfurl',
							data: qs.stringify({
								ts: req.body.event.message_ts,
								channel: req.body.event.channel,
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
			}
			default: {
				logger.info(`Unknown type "${req.body.type}"`);
				logger.info(req.body);
				break;
			}
		}
	});
};
