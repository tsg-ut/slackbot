import qs from 'querystring';
import axios from 'axios';
// @ts-ignore
import Slack from '../lib/slackMock.js';

jest.mock('axios');

// @ts-ignore
axios.response = {data: {title: 'hoge', descriptions: ['fuga', 'piyo']}};

let slack: Slack = null;

const projectName = 'PROJECTNAME';
process.env.SCRAPBOX_PROJECT_NAME = projectName;


// eslint-disable-next-line import/first, import/imports-first, import/order
import {Page, PageInfo} from '../lib/scrapbox';
// eslint-disable-next-line import/first, import/imports-first
import scrapbox from './index';

describe('unfurl', () => {
	let fetchInfoSpy: jest.SpyInstance<Promise<PageInfo>> | null = null;

	beforeEach(async () => {
		fetchInfoSpy = jest.spyOn(Page.prototype, 'fetchInfo')
			.mockImplementation(() => Promise.resolve({title: 'hoge', descriptions: ['fuga', 'piyo']} as PageInfo));
		// cast this because it is too demanding to completely write down all properties
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await scrapbox(slack);
	});

	afterEach(() => {
		fetchInfoSpy!.mockRestore();
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
				throw Error(`axios-mock: unknown URL: ${url}`);
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
