jest.mock('axios');

import slacklog from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
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

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await slacklog(slack);
});

describe('slacklog', () => {
	it('respond to slack hook of slacklog unfurling', async () => {
		const done = new Promise((resolve) => {
			// @ts-ignore
			axios.mockImplementation(({url, data}: {url: string, data: any}) => {
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
		
		slack.eventClient.emit('link_shared', {
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
		});

		return done;
	});
});
