jest.mock('axios');

// @ts-ignore
import Slack from '../lib/slackMock.js';
import axios from 'axios';
import qs from 'querystring';
import { escapeRegExp, set } from 'lodash';
import { fastifyDevConstructor } from '../lib/fastify';
import {MessageAttachment} from '@slack/client';


// @ts-ignore
axios.response = {data: {title: 'hoge', descriptions: ['fuga', 'piyo']}};

let slack: Slack = null;

const projectName = 'PROJECTNAME';
process.env.SCRAPBOX_PROJECT_NAME = projectName;
import scrapbox from './index';
import {server, muteTag} from './index';

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
					expect(unfurls[`https://scrapbox.io/${projectName}/hoge`]).toBeTruthy();
					expect(unfurls[`https://scrapbox.io/${projectName}/hoge`].text).toBe('fuga\npiyo');
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
					url: `https://scrapbox.io/${projectName}/hoge`,
				},
			],
		});

		return done;
	});
});

describe('scrapbox', () => {
	it('mutes pages with ##ミュート tag', async () => {
		const fakeChannel = 'CSCRAPBOX';
		process.env.CHANNEL_SCRAPBOX = fakeChannel;
		const fastify = fastifyDevConstructor();
		// eslint-disable-next-line array-plural/array-plural
		const attachments_req: (MessageAttachment & any)[] = [
			{
				title: 'page 1',
				title_link: `https://scrapbox.io/${projectName}/page_1#c632c886dc3061e3b85cabbd`,
				text: 'hoge',
				rawText: 'hoge',
				mrkdwn_in: ['text'],
				author_name: 'Alice',
				image_url: 'https://example.com/hoge1.png',
				thumb_url: 'https://example.com/fuga1.png',
			},
			{
				title: 'page 2',
				title_link: `https://scrapbox.io/${projectName}/page_2#aaf8924806eb538413c07c43`,
				text: 'hoge',
				rawText: 'hoge',
				mrkdwn_in: ['text'],
				author_name: 'Bob',
				image_url: 'https://example.com/hoge2.png',
				thumb_url: 'https://example.com/fuga2.png',
			},
		];
		// @ts-ignore
		axios.get.mockImplementation((url: string) => {
			if (url === `https://scrapbox.io/api/pages/${projectName}/${encodeURIComponent(muteTag)}`) {
				return set({}, ['data', 'relatedPages', 'links1hop'], [{titleLc: 'page_1'}]);
			}
			throw Error(`axios-mock: unexpected URL: ${url}`);
		});

		slack = {chat: {
			postMessage: jest.fn(),
		}};
		fastify.register(server({webClient: slack} as any));
		const args = {
			text: `New lines on <https://scrapbox.io/${projectName}|${projectName}>`,
			mrkdwn: true,
			username: 'Scrapbox',
			attachments: attachments_req,
		};
		const {payload, statusCode} = await fastify.inject({
			method: 'POST',
			url: '/hooks/scrapbox',
			payload: args,
		});
		if (statusCode !== 200) {
			throw JSON.parse(payload);
		}
		expect(slack.chat.postMessage.mock.calls.length).toBe(1);
		const {channel, text, attachments: attachments_res}: {channel: string; text: string; attachments: MessageAttachment[]} = slack.chat.postMessage.mock.calls[0][0];
		expect(channel).toBe(fakeChannel);
		expect(text).toBe(args.text);
		const unchanged = ['title', 'title_link', 'mrkdwn_in', 'author_name'] as const;
		for (const i of [0, 1]) {
			for (const key of unchanged) {
				expect(attachments_res[i][key]).toEqual(attachments_req[i][key]);
			}
		}
		const nulled = ['image_url', 'thumb_url'] as const;
		for (const key of nulled) {
			expect(attachments_res[0][key]).toBeNull();
			// eslint-disable-next-line array-plural/array-plural
			expect(attachments_res[1][key]).toEqual(attachments_req[1][key]);
		}
		expect(attachments_res[0].text).toContain('ミュート');
		// eslint-disable-next-line array-plural/array-plural
		expect(attachments_res[1].text).toBe(attachments_req[1].text);
	});
});
