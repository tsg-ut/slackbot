"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSlackPostParams = void 0;
const twitter_1 = __importDefault(require("twitter"));
const moment_1 = __importDefault(require("moment"));
const fs_1 = require("fs");
const twitterClient = new twitter_1.default({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
const getDMs = async ({ after, count } = { count: 50 }) => {
    const response = await twitterClient.get('direct_messages/events/list', { count });
    const events = response.events;
    return after ? events.filter(event => event.id > after) : events;
};
const getUserInfo = async (id) => {
    const user = await twitterClient.get('users/show', { user_id: id });
    return {
        id: user.id_str,
        name: user.name,
        screen_name: user.screen_name,
        profile: user.description,
        iconImageUrl: user.profile_image_url_https,
        isProtected: user.protected,
    };
};
const createSlackPostParams = async (after) => {
    const dms = await getDMs();
    const newDMs = dms.filter(dm => (0, moment_1.default)(dm.created_timestamp, 'x').unix() > after.unix()).reverse();
    let latestUser;
    let params = [];
    for (const dm of newDMs) {
        const userId = dm.message_create.sender_id;
        const isUserUpdated = latestUser?.id !== userId;
        const user = isUserUpdated ? await getUserInfo(dm.message_create.sender_id) : latestUser;
        latestUser = user;
        let text = dm.message_create.message_data.text;
        for (const url of dm.message_create.message_data.entities.urls) {
            text = text.replace(url.url, url.expanded_url);
        }
        const blocks = [{
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: text,
                },
            }];
        const userDescription = (user.isProtected ? ':lock:' : '')
            + ` ${user.name} `
            + `<https://twitter.com/${user.screen_name}|@${user.screen_name}>`;
        if (isUserUpdated) {
            blocks.unshift({
                type: 'context',
                elements: [
                    {
                        type: 'image',
                        image_url: user.iconImageUrl,
                        alt_text: `@${user.screen_name}'s icon`,
                    },
                    {
                        type: 'mrkdwn',
                        text: userDescription + '\n' + user.profile,
                    },
                ],
            });
        }
        params.push({
            time: dm.created_timestamp,
            text: dm.message_create.message_data.text,
            blocks,
        });
    }
    return params;
};
exports.createSlackPostParams = createSlackPostParams;
const cacheFilePath = 'twitter-dm-notifier/after.txt';
const getAfterValue = async () => {
    return fs_1.promises.readFile(cacheFilePath, 'utf-8').then(data => {
        return (0, moment_1.default)(data.trim());
    }).catch(async () => {
        const now = (0, moment_1.default)();
        await fs_1.promises.writeFile(cacheFilePath, now.format());
        return now;
    });
};
const saveAfterValue = async (after) => {
    await fs_1.promises.writeFile(cacheFilePath, after.format());
};
exports.default = async ({ webClient }) => {
    let after = await getAfterValue();
    setInterval(async () => {
        const slackPostParams = await (0, exports.createSlackPostParams)(after);
        for (const param of slackPostParams) {
            await webClient.chat.postMessage({
                channel: process.env.CHANNEL_PUBLIC_OFFICE,
                username: 'Direct message',
                icon_emoji: ':twitter:',
                text: param.text,
                blocks: param.blocks,
            });
        }
        if (slackPostParams.length > 0) {
            const latest = (0, moment_1.default)(slackPostParams[slackPostParams.length - 1].time, 'x');
            after = latest;
            await saveAfterValue(latest);
        }
    }, 15 * 60 * 1000);
};
