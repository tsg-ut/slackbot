jest.mock('axios');

import * as scrapbox from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import Fastify from 'Fastify';
import axios from 'axios';

// @ts-ignore
axios.response = {data: {title: 'hoge', descriptions: ['fuga', 'piyo']}};

let slack: Slack = null;
let fastify: Fastify.FastifyInstance = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	fastify = Fastify();
	scrapbox.server(slack)(fastify);
});

afterEach(() => {
	fastify.close();
});

describe('scrapbox', () => {
	it('respond to slack hook of scrapbox unfurling', async () => {
		const done = new Promise((resolve) => {
			slack.on('chat.unfurl', ({unfurls}: any) => {
				expect(unfurls['https://scrapbox.io/tsg/hoge']).toBeTruthy();
				expect(unfurls['https://scrapbox.io/tsg/hoge'].text).toBe('fuga\npiyo');
				resolve();
			});
		});

		const response = await fastify.inject({
			method: 'POST',
			url: '/unfurl/scrapbox',
			payload: {
				token: 'XXYYZZ',
				team_id: 'TXXXXXXXX',
				api_app_id: 'AXXXXXXXXX',
				event: {
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
				},
				type: 'event_callback',
				authed_users: [
					'UXXXXXXX1',
					'UXXXXXXX2',
				],
				event_id: 'Ev08MFMKH6',
				event_time: 123456789,
			},
		});
		expect(response.payload).toBe('Done.');

		return done;
	});

	it('respond to slack hook url verification', async () => {
		const response = await fastify.inject({
			method: 'POST',
			url: '/unfurl/scrapbox',
			payload: {
				type: 'url_verification',
				challenge: 'hogefugapiyofoobar',
			},
		});
		expect(response.payload).toBe('hogefugapiyofoobar');
	});
});
