const axios = require('axios');
const logger = require('../lib/logger.js');
const {FastifyInstance} = require('fastify');
const {LinkUnfurls} = require('@slack/client');
const qs = require('querystring');

const slacklogAPIDomain = 'localhost:9292';
const slacklogURLRegexp = RegExp(`^https?://slack-log.tsg.ne.jp/([A-Z0-9]+)/([0-9]+\.[0-9]+)`);
const getAroundMessagesUrl = (channel) => `http://${slacklogAPIDomain}/around_messages/${channel}.json`;

module.exports.server = () => async (fastify) => {
	const users = await axios.get(`http://${slacklogAPIDomain}/users.json`).then(({data}) => data);

	fastify.post('/unfurl/slacklog', async (req) => {
		if (!req.body) {
			return 'Not Implemented.';
		}

		switch (req.body.type) {
			case 'url_verification': {
				return req.body.challenge;
			}
			case 'event_callback': {
				logger.info('Incoming unfurl request >');
				req.body.event.links.map((link) => logger.info('-', link));
				const unfurls = {};
				for (const link of req.body.event.links) {
					const { url, domain } = link;
					if (domain !== 'slack-log.tsg.ne.jp') continue;
					if (!slacklogURLRegexp.test(url)) continue;

					const [_, channel, ts] = slacklogURLRegexp.exec(url);

					const aroundMessagesUrl = getAroundMessagesUrl(channel);
					const response = await axios.post(aroundMessagesUrl, qs.stringify({ts}));
					const message = response.data.messages.find(m => m.ts === ts);
					if (!message) continue;
					const {text, user: userid} = message;
					const user = userid && users[userid];
					const username = user && user.name;
					const imageUrl = user && user.profile && (user.profile.image_original || user.profile.image_512);

					unfurls[url] = {
						title: username || userid,
						title_link: url,
						author_name: username || userid,
						author_icon: imageUrl || ':void:',
						text: text,
						color: '#4D394B',
					};
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
