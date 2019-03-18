jest.mock('axios');

import scrapbox from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import axios from 'axios';
import qs from 'querystring';

// @ts-ignore
axios.response = {data: {title: 'hoge', descriptions: ['fuga', 'piyo']}};

let slack: Slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await scrapbox(slack);
});

describe('scrapbox', () => {
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
