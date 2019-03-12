jest.mock('axios');

// @ts-ignore
import * as slacklogUnfurl from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import Fastify from 'fastify';
import axios from 'axios';
import qs from 'querystring';

// @ts-ignore
axios.response = {data: {messages: [{
	channel: 'CYYYYYY',
	user: 'UYYYYYY',
	ts: '1234.5678',
	text: 'fuga\npiyo',
}]}};

let slack: Slack = null;
let fastify: Fastify.FastifyInstance = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	fastify = Fastify();
	slacklogUnfurl.server()(fastify);
});

afterEach(() => {
	fastify.close();
});

describe('slacklog-unfurl', () => {
	it('respond to slack hook of slacklog unfurling', async () => {
		const done = new Promise((resolve) => {
			// @ts-ignore
			axios.mockImplementation(({url, data}: {url: string}) => {
				if (url === 'https://slack.com/api/chat.unfurl') {
					const parsed = qs.parse(data);
					const unfurls = JSON.parse(Array.isArray(parsed.unfurls) ? parsed.unfurls[0] : parsed.unfurls);
					expect(unfurls['https://slack-log.tsg.ne.jp/CYYYYYY/1234.5678']).toBeTruthy();
					expect(unfurls['https://slack-log.tsg.ne.jp/CYYYYYY/1234.5678'].text).toBe('fuga\npiyo');
					resolve();
					return Promise.resolve({data: {ok: true}});
				}
				// @ts-ignore
				return Promise.resolve(axios.response);
			});
		});

		const response = await fastify.inject({
			method: 'POST',
			url: '/unfurl/slacklog',
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
							domain: 'slack-log.tsg.ne.jp',
							url: 'https://slack-log.tsg.ne.jp/CYYYYYY/1234.5678',
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
			url: '/unfurl/slacklog',
			payload: {
				type: 'url_verification',
				challenge: 'hogefugapiyofoobar',
			},
		});
		expect(response.payload).toBe('hogefugapiyofoobar');
	});
});
