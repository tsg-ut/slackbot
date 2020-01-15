jest.mock('axios');

import scrapbox from './index.ts';
import {server} from './index.ts';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import axios from 'axios';
import qs from 'querystring';
import fastifyConstructor from 'fastify';
import {MessageAttachment} from '@slack/client';


// @ts-ignore
axios.response = {data: {title: 'hoge', descriptions: ['fuga', 'piyo']}};

let slack: Slack = null;


describe('scrapbox', () => {
	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await scrapbox(slack);
	});

	it('respond to slack hook of scrapbox unfurling', async () => {
		const done = new Promise((resolve) => {
			// @ts-ignore
			axios.mockImplementation(({url, data}: {url: string, data: any}) => {
				if (url === 'https://slack.com/api/chat.unfurl') {
					const parsed = qs.parse(data);
					const unfurls = JSON.parse(Array.isArray(parsed.unfurls) ? parsed.unfurls[0] : parsed.unfurls);
					expect(unfurls['https://scrapbox.io/tsg/hoge']).toBeTruthy();
					expect(unfurls['https://scrapbox.io/tsg/hoge'].text).toBe('fuga\npiyo');
					resolve();
					return Promise.resolve({data: {ok: true}});
				}
				// @ts-ignore
				return Promise.resolve(axios.response);
			});
		});

		slack.eventClient.emit('link_shared', {
			type: 'link_shared',
			channel: 'Cxxxxxx',
			user: 'Uxxxxxxx',
			message_ts: '123452389.9875',
			thread_ts: '123456621.1855',
			links: [
				{
					domain: 'scrapbox.io',
					url: 'https://scrapbox.io/tsg/hoge',
				},
			],
		});

		return done;
	});
});

describe('scrapbox', () => {
	it('mutes pages with ##ミュート tag', () => new Promise((resolve) => {
		slack = new Slack();
		process.env.CHANNEL_SCRAPBOX = slack.fakeChannel;
		const fastify = fastifyConstructor();
		fastify.register(server(slack));
		const attachments_req = [
			{
				title: 'page 1',
				title_link: 'https://scrapbox.io/tsg/page_1#c632c886dc3061e3b85cabbd',
				text: 'hoge',
				rawText: 'hoge',
				mrkdwn_in: ['text'],
				author_name: 'Alice',
				image_url: 'https://example.com/hoge1.png',
				thumb_url: 'https://example.com/fuga1.png',
			},
			{
				title: 'page 2',
				title_link: 'https://scrapbox.io/tsg/page_2#aaf8924806eb538413c07c43',
				text: 'hoge',
				rawText: 'hoge',
				mrkdwn_in: ['text'],
				author_name: 'Bob',
				image_url: 'https://example.com/hoge2.png',
				thumb_url: 'https://example.com/fuga2.png',
			},
		];

		slack.on('message', ({channel, text, attachments: attachments_res}: {channel: string; text: string; attachments: MessageAttachment[]}) => {
			expect(channel).toBe(slack.fakeChannel);
			expect(text).toBeInstanceOf('string');
			const unchanged = ['title', 'title_link', 'mrkdwn_in', 'author_name'] as const;
			for (const i of [0, 1]) {
				for (const key of unchanged) {
					expect(attachments_res[i][key]).toBe(attachments_req[i][key])
				}
			}
			const nulled = ['image_url', 'thumb_url'] as const;
			for (const key of nulled) {
				expect(attachments_res[0][key]).toBeNull();
				expect(attachments_res[1][key]).toBe(attachments_req[1][key]);
			}
			expect(attachments_res[0].text).toContain('ミュート');
			expect(attachments_res[1].text).toBe(attachments_req[1].text);
			resolve();
		});

		// TODO: mock axios

		fastify.inject({
			method: 'POST',
			url: '/scrapbox',
			payload: {
				text: 'New lines on <https://scrapbox.io/tsg|tsg>',
				mrkdwn: true,
				username: 'Scrapbox',
				attachments_req,
			},
		});
	}));
});
