"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const somebody54 = {
    id_str: '123456789',
    name: '誰か54',
    screen_name: 'somebody54',
    description: '何かが得意 何かが苦手',
    protected: false,
    verified: false,
    followers_count: 123,
    friends_count: 456,
    listed_count: 7,
    favourites_count: 8,
    statuses_count: 9,
    created_at: 'Wed Nov 07 13:12:58 +0000 2012',
    profile_image_url_https: 'https://pbs.twimg.com/profile_images/123456789/XXXXXXXX_normal.jpg',
    default_profile: false,
    default_profile_image: false,
};
const dummyMessageGenerator = (time, sender_id, text) => {
    return {
        type: 'message_create',
        created_timestamp: time,
        message_create: {
            target: {
                recipient_id: '219587655', // TSG account's id
            },
            sender_id: sender_id,
            message_data: {
                text: text,
                entities: {
                    hashtags: [],
                    symbols: [],
                    user_mentions: [],
                    urls: [],
                },
            },
        },
    };
};
class Twitter {
    async get(path, options) {
        if (path === 'direct_messages/events/list') {
            // https://developer.twitter.com/en/docs/direct-messages/sending-and-receiving/api-reference/list-events
            // Ignoring count
            return {
                events: [
                    dummyMessageGenerator((Date.now() - 54).toString(), somebody54.id_str, 'What should I do?'),
                    dummyMessageGenerator((Date.now() - 5454).toString(), somebody54.id_str, 'I wanna join TSG'),
                    dummyMessageGenerator((Date.now() - 5454545454).toString(), somebody54.id_str, 'This message is too old'),
                ],
            };
        }
        else if (path === 'users/show') {
            // https://developer.twitter.com/en/docs/accounts-and-users/follow-search-get-users/api-reference/get-users-show
            if ((options.user_id || options.screen_name) === undefined) {
                throw 'Either a id or screen_name is required for this method.';
            }
            return {
                ...somebody54,
                ...(options.user_id ? { id_str: options.user_id } : {}),
                ...(options.screen_name ? { screen_name: options.screen_name } : {}),
            };
        }
    }
}
module.exports = Twitter;
