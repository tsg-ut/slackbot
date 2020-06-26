import Twitter from 'twitter';
import dotenv from 'dotenv';
import moment from 'moment';
import type { SlackInterface } from '../lib/slack';
dotenv.config();

const twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY!,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET!,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY!,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
});

interface Event {
    id: string; // Numeric
    created_timestamp: string; // Numeric
} // https://developer.twitter.com/en/docs/direct-messages/sending-and-receiving/api-reference/list-events

interface MessageCreateEvent extends Event {
    type: 'message_create';
    message_create: {
        target: {
            recipient_id: string; // Numeric
        };
        sender_id: string;
        source_app_id: string;
        message_data: {
            text: string; // DM 本文
            entities: {
                hashtags: any[]; // 使わんので略
                symbols: any[]; // 使わんので略
                user_mentions: any[]; // 使わんので略
                urls: URL[];
            }; // https://developer.twitter.com/en/docs/tweets/data-dictionary/overview/entities-object
            attachment?: {
                type: 'media';
                media: Media;
            };
        }
    };
}

interface URL {
    url: string; // https://t.co/...
    expanded_url: string; // Original URL
    display_url: string; // URL pasted/typed into Tweet.
    indices: [number, number];
}

interface Size {
    w: number;
    h: number;
    resize: 'crop' | 'fit';
}

interface Media {
    id: number; // 64-bit integer
    id_str: string;
    indices: [number, number];
    media_url: string; // http://pbs.twimg.com/media/XXXXXXXXXXXXX.jpg
    media_url_https: string; // https://pbs.twimg.com/media/XXXXXXXXXXXXX.jpg
    url: string; // https://t.co/******
    display_url: string; // pic.twitter.com/...
    expanded_url: string; // https://twitter.com/*******/status/XXXXXXXXXXXXXXX/photo/1
    type: 'photo' | 'video' | 'animated_gif';
    sizes: {
        thumb: Size;
        small: Size;
        medium: Size;
        large: Size;
    };
    source_status_id?: number; // 64-bit integer
    source_status_id_str?: string;
} // https://developer.twitter.com/en/docs/tweets/data-dictionary/overview/entities-object

interface ProfileGeo {
    country: string;
    country_code: string;
    locality: string;
    region: string;
    sub_region: string;
    full_name: string;
    geo: {
        coordinates: [ number, number ];
        type: string;
    }
}

interface User {
    id: number; // greater than 53 bits
    id_str: string;
    name: string;
    screen_name: string;
    location?: string;
    derived: ProfileGeo;
    url?: string;
    description?: string;
    protected: boolean;
    verified: boolean;
    followers_count: number;
    friends_count: number; // following
    listed_count: number;
    favourites_count: number;
    statuses_count: number;
    created_at: string;
    profile_banner_url: string;
    profile_image_url_https: string;
    default_profile: boolean;
    default_profile_image: boolean;
    withheld_in_countries: string[];
    withheld_scope: string;
} // https://developer.twitter.com/en/docs/tweets/data-dictionary/overview/user-object

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

export default async ({ webClient }: SlackInterface) => {
    const job = async () => {
        const dms = await getDMs();
        const newDMs = dms.filter(dm =>
            moment(dm.created_timestamp, 'x') > moment().subtract(2, 'minutes')
        ).reverse();
        let latestUser: UserInfo | undefined;
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
            await webClient.chat.postMessage({
                channel: process.env.CHANNEL_PUBLIC_OFFICE,
                username: 'Direct message to @tsg_ut',
                icon_emoji: ':twitter:',
                text: dm.message_create.message_data.text,
                blocks,
            });
        }
    };

    setInterval(job, 2 * 60 * 1000);
};