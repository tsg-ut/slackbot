// https://developer.twitter.com/en/docs/direct-messages/sending-and-receiving/api-reference/list-events
interface Event {
    id: string; // Numeric
    created_timestamp: string; // Numeric
}
export interface MessageCreateEvent extends Event {
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
            };
            attachment?: {
                type: 'media';
                media: Media;
            };
        }
    };
}

// https://developer.twitter.com/en/docs/tweets/data-dictionary/overview/entities-object
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
}

// https://developer.twitter.com/en/docs/tweets/data-dictionary/overview/user-object
export interface User {
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
}

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