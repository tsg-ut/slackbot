import { createSlackPostParams } from './index';
import moment from 'moment';

describe('twitter-dm-notifier', () => {
    it('Create Slack Blocks for Twitter DMs', async () => {
        const params = await createSlackPostParams(moment().subtract(2, 'minutes'));
        expect(params.map(param => ({
            text: param.text,
            blocks: param.blocks,
        }))).toStrictEqual([
            {
                text: 'I wanna join TSG',
                blocks: [
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'image',
                                image_url: 'https://pbs.twimg.com/profile_images/123456789/XXXXXXXX_normal.jpg',
                                alt_text: "@somebody54's icon",
                            },
                            {
                                type: 'mrkdwn',
                                text: '<https://twitter.com/somebody54|@somebody54>'
                                    + '\n'
                                    + '何かが得意 何かが苦手',
                            },
                        ],
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: 'I wanna join TSG',
                        },
                    },
                ],
            },
            {
                text: 'What should I do?',
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: 'What should I do?',
                        },
                    },
                ],
            },
        ]);
    });
});