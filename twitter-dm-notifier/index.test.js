"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const moment_1 = __importDefault(require("moment"));
describe('twitter-dm-notifier', () => {
    it('Create Slack Blocks for Twitter DMs', async () => {
        const params = await (0, index_1.createSlackPostParams)((0, moment_1.default)().subtract(2, 'minutes'));
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
                                text: ' 誰か54 <https://twitter.com/somebody54|@somebody54>'
                                    + '\n'
                                    + '何かが得意 何かが苦手',
                            },
                        ],
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
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
                            type: 'mrkdwn',
                            text: 'What should I do?',
                        },
                    },
                ],
            },
        ]);
    });
});
