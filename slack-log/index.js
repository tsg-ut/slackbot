"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../lib/logger"));
const querystring_1 = __importDefault(require("querystring"));
const log = logger_1.default.child({ bot: 'slack-log' });
const slacklogAPIDomain = process.env.SLACK_PATRON_API_HOST || 'localhost:4567';
const slacklogURLRegexp = new RegExp('^https?://slack-log.tsg.ne.jp/([A-Z0-9]+)/([0-9]+\.[0-9]+)');
const getAroundMessagesUrl = (channel) => `http://${slacklogAPIDomain}/around_messages/${channel}.json`;
exports.default = async ({ eventClient, webClient: slack, eventClient: event }) => {
    const users = await axios_1.default.get(`http://${slacklogAPIDomain}/users.json`).then(({ data }) => data);
    const channels = await axios_1.default.get(`http://${slacklogAPIDomain}/channels.json`).then(({ data }) => data);
    eventClient.on('message', async ({ channel, text }) => {
        if (!text) {
            return;
        }
        const trim = text.trim();
        const [command, ...queries] = trim.split(/\s+/);
        if (command === 'slacklog') {
            const url = queries.join(' ');
            const slackURLRegexp = new RegExp('^<https?://tsg-ut.slack.com/archives/([A-Z0-9]+)/p([0-9]+)([0-9]{6})\\S*>');
            if (slackURLRegexp.test(url)) {
                const [_, chanid, ts1, ts2] = slackURLRegexp.exec(url);
                slack.chat.postMessage({
                    icon_emoji: 'slack',
                    channel,
                    text: `<https://slack-log.tsg.ne.jp/${chanid}/${ts1}.${ts2}>`,
                    unfurl_links: true,
                });
            }
            else if (queries.length > 0) {
                const convertedQueries = queries.map((query) => {
                    let matches;
                    if ((matches = query.match(/^<@(?<userId>.+?)>$/))) {
                        const { userId } = matches.groups;
                        return `user:${userId}`;
                    }
                    if ((matches = query.match(/^<#(?<channelId>.+?)(:?\|.+?)?>$/))) {
                        const { channelId } = matches.groups;
                        return `channel:${channelId}`;
                    }
                    if ((matches = query.match(/^\+:(?<emojiName>.+?):$/))) {
                        const { emojiName } = matches.groups;
                        return `reactions.name:${emojiName}`;
                    }
                    return query;
                });
                const url = `<https://slack-log.tsg.ne.jp/search/${encodeURIComponent(convertedQueries.join(' '))}>`;
                slack.chat.postMessage({ icon_emoji: 'slack', channel, text: url });
            }
            else {
                const here = `<https://slack-log.tsg.ne.jp/${channel}>`;
                slack.chat.postMessage({ icon_emoji: 'slack', channel, text: here });
            }
        }
    });
    event.on('link_shared', async (e) => {
        const links = e.links.filter(({ domain }) => domain === 'slack-log.tsg.ne.jp');
        links.map((link) => log.info('-', link));
        const unfurls = {};
        for (const link of links) {
            const { url, domain } = link;
            if (!slacklogURLRegexp.test(url)) {
                continue;
            }
            const [_, chanid, ts] = slacklogURLRegexp.exec(url);
            const aroundMessagesUrl = getAroundMessagesUrl(chanid);
            const response = await axios_1.default.post(aroundMessagesUrl, querystring_1.default.stringify({ ts }));
            const message = response.data.messages.find((m) => m.ts === ts);
            if (!message) {
                continue;
            }
            const { text, user: userid } = message;
            const user = userid && users[userid];
            const username = user && (user.profile.display_name || user.name);
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
                const data = await slack.chat.unfurl({
                    ts: e.message_ts,
                    channel: e.channel,
                    unfurls: unfurls,
                });
                if (!data.ok) {
                    throw data;
                }
            }
            catch (error) {
                log.error('✗ chat.unfurl >', error);
            }
        }
    });
};
