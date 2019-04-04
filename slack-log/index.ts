import axios from 'axios';
// @ts-ignore
import logger from '../lib/logger.js';
import {LinkUnfurls} from '@slack/client';
import qs from 'querystring';

const slacklogAPIDomain = 'localhost:9292';
const slacklogURLRegexp = RegExp('^https?://slack-log.tsg.ne.jp/([A-Z0-9]+)/([0-9]+\.[0-9]+)');
const getAroundMessagesUrl = (channel: string) => `http://${slacklogAPIDomain}/around_messages/${channel}.json`;

import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
    rtmClient: RTMClient,
    webClient: WebClient,
    eventClient: any,
}

export default async ({rtmClient: rtm, webClient: slack, eventClient: event}: SlackInterface) => {
    const users = await axios.get(`http://${slacklogAPIDomain}/users.json`).then(({data}) => data);
    const channels = await axios.get(`http://${slacklogAPIDomain}/channels.json`).then(({data}) => data);

    rtm.on('message', async ({channel, text}) => {
        if (!text) {
            return;
        }

        if (text.trim() === 'slacklog' || text.trim() === 'slack-log') {
            const here = `https://slack-log.tsg.ne.jp/${channel}`;
            slack.chat.postMessage({icon_emoji: 'slack', channel, text: here});
        }
    });

    event.on('link_shared', async (e: any) => {
        logger.info('Incoming unfurl request >');
        const links = e.links.filter(({domain}: {domain: string}) => domain === 'slack-log.tsg.ne.jp');
        links.map((link: string) => logger.info('-', link));

        const unfurls: LinkUnfurls = {};
        for (const link of links) {
            const {url, domain} = link;
            if (!slacklogURLRegexp.test(url)) {
                continue;
            }

            const [_, chanid, ts] = slacklogURLRegexp.exec(url);

            const aroundMessagesUrl = getAroundMessagesUrl(chanid);
            const response = await axios.post(aroundMessagesUrl, qs.stringify({ts}));
            const message = response.data.messages.find((m: {ts: string}) => m.ts === ts);
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

                if (!data.ok) {
                    throw data;
                }
            } catch (error) {
                logger.error('✗ chat.unfurl >', error);
            }
        }
    });
};
