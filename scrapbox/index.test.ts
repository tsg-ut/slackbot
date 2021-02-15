import qs from 'querystring';
import axios from 'axios';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import scrapbox, {scrapbox2slack} from './index';

jest.mock('axios');

// @ts-ignore
axios.response = {data: {
	title: 'hoge',
	descriptions: ['fuga', 'piyo'],
	lines: [
		{
			id: 'f00a',
			text: 'fuga',
		},
		{
			id: '0140',
			text: 'piyo',
		},
	],
}};

let slack: Slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await scrapbox(slack);
});

describe('scrapbox', () => {
	it('respond to slack hook of scrapbox unfurling', async () => {
		const done = new Promise<void>((resolve) => {
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

	it('respond to slack hook of scrapbox unfurling with line specified', async () => {
		const done = new Promise<void>((resolve) => {
			// @ts-ignore
			axios.mockImplementation(({url, data}: {url: string, data: any}) => {
				if (url === 'https://slack.com/api/chat.unfurl') {
					const parsed = qs.parse(data);
					const unfurls = JSON.parse(Array.isArray(parsed.unfurls) ? parsed.unfurls[0] : parsed.unfurls);
					expect(unfurls['https://scrapbox.io/tsg/hoge#0140']).toBeTruthy();
					expect(unfurls['https://scrapbox.io/tsg/hoge#0140'].text).toBe('piyo');
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
					url: 'https://scrapbox.io/tsg/hoge#0140',
				},
			],
		});

		return done;
	});

	it('convert Scrapbox-style text to Slack-style text', () => {
		const exampleScrapboxText = `
			#debug
			[*** ひとこと]
			>カラオケの鉄人
			これすき [hideo54.icon] (ソース: [用語集])
			[* [太字内部リンク]]
			[** [TSG 公式サイト https://tsg.ne.jp/]]
		`;
		const expectedSlackText = `
			<https://scrapbox.io/tsg/debug|#debug>
			*ひとこと*
			>カラオケの鉄人
			これすき <https://scrapbox.io/tsg/hideo54|hideo54> (ソース: <https://scrapbox.io/tsg/用語集|用語集>)
			*<https://scrapbox.io/tsg/太字内部リンク|太字内部リンク>*
			*<https://tsg.ne.jp/|TSG 公式サイト>*
		`;
		expect(scrapbox2slack(exampleScrapboxText)).toBe(expectedSlackText);
	});
});
