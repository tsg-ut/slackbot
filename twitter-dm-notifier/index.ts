import Twitter from 'twitter';
import moment, { Moment } from 'moment';
import { promises as fs } from 'fs';
import type { MessageCreateEvent, User } from '../lib/twitter';
import type { SlackInterface } from '../lib/slack';

const twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY!,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET!,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY!,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
});

const getDMs = async (options: { after?: string; count: number; } = { count: 50 }) => {
    const { after, count } = options;
    const response = await twitterClient.get('direct_messages/events/list', { count });
    const events = response.events as MessageCreateEvent[];
    return after ? events.filter(event => event.id > after) : events;
};

interface UserInfo {
    id: string;
    name: string;
    screen_name: string;
    profile: string;
    iconImageUrl: string;
    isProtected: boolean;
}

const getUserInfo = async (id: string) => {
    const user = await twitterClient.get('users/show', { user_id: id }) as User;
    return {
        id: user.id_str,
        name: user.name,
        screen_name: user.screen_name,
        profile: user.description,
        iconImageUrl: user.profile_image_url_https,
        isProtected: user.protected,
    } as UserInfo;
};

export const createSlackPostParams = async (after: Moment) => {
    const dms = await getDMs();
    const newDMs = dms.filter(dm =>
        moment(dm.created_timestamp, 'x') > after
    ).reverse();
    let latestUser: UserInfo | undefined;
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
        const blocks: any = [{
            type: 'section',
            text: {
                type: 'plain_text',
                text: text,
            },
        }];
        const userDescription = (user.isProtected ? ':lock:' : '')
            + ` ${user.name} `
            + `<https://twitter.com/${user.screen_name}|@${user.screen_name}>`;
        if (isUserUpdated) {
            blocks.unshift(
                {
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
                },
            );
        }
        params.push({
            time: dm.created_timestamp,
            text: dm.message_create.message_data.text,
            blocks,
        });
    }
    return params;
};

const cacheFilePath = 'twitter-dm-notifier/after.txt';

const getAfterValue = async () => {
    return fs.readFile(cacheFilePath, 'utf-8').then(data => {
        return moment(data);
    }).catch(async () => {
        const now = moment();
        await fs.writeFile(cacheFilePath, now.format());
        return now;
    });
};

export default async ({ webClient }: SlackInterface) => {
    let after = await getAfterValue();
    setInterval(async () => {
        const slackPostParams = await createSlackPostParams(after);
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
            after = moment(slackPostParams[slackPostParams.length - 1].time, 'x');
        }
    }, 2 * 60 * 1000);
};