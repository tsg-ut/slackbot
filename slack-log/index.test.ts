import type {ChatUnfurlArguments} from '@slack/web-api';
import axios from 'axios';
import slacklog from './index';
import Slack from '../lib/slackMock';

jest.mock('axios');

// @ts-expect-error
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
	it('respond to slacklog url request', async () => {
		const {channel, text} = await slack.getResponseTo('slacklog');

		expect(channel).toBe(slack.fakeChannel);
		expect(text).toMatch('slack-log.tsg.ne.jp');
		expect(text).toMatch(slack.fakeChannel);
	});

	it('respond to canonical slacklog-ize request', async () => {
		const requestURL: string = '<https://tsg-ut.slack.com/archives/C0123ABCD/p1501234567890123>';
		const {channel, text} = await slack.getResponseTo(`slacklog ${requestURL}`);

		const expectURL: string = '<https://slack-log.tsg.ne.jp/C0123ABCD/1501234567.890123>';
		expect(channel).toBe(slack.fakeChannel);
		expect(text).toBe(expectURL);
	});

	it('respond to slacklog-ize request of practical url from default web UI', async () => {
		const requestURL: string = '<https://tsg-ut.slack.com/archives/C7AAX50QY/p1603287289337400?thread_ts=1603267719.496100&amp;cid=C7AAX50QY>';
		const {channel, text} = await slack.getResponseTo(`slacklog ${requestURL}`);

		const expectURL: string = '<https://slack-log.tsg.ne.jp/C7AAX50QY/1603287289.337400>';
		expect(channel).toBe(slack.fakeChannel);
		expect(text).toBe(expectURL);
	});

	it('respond to slacklog-ize request of practical url from iOS app', async () => {
		const requestURL: string = '<https://tsg-ut.slack.com/archives/C7AAX50QY/p1603288141348600?thread_ts=1603287978.345500&channel=C7AAX50QY&message_ts=1603288141.348600>';
		const {channel, text} = await slack.getResponseTo(`slacklog ${requestURL}`);

		const expectURL: string = '<https://slack-log.tsg.ne.jp/C7AAX50QY/1603288141.348600>';
		expect(channel).toBe(slack.fakeChannel);
		expect(text).toBe(expectURL);
	});

	it('respond to slack hook of slacklog unfurling', async () => {
		const done = new Promise<void>((resolve) => {
			slack.on('chat.unfurl', ({unfurls}: ChatUnfurlArguments) => {
				expect(unfurls['https://slack-log.tsg.ne.jp/CYYYYYY/1234.5678']).toBeTruthy();
				expect(unfurls['https://slack-log.tsg.ne.jp/CYYYYYY/1234.5678'].text).toBe('fuga\npiyo');
				resolve();
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
