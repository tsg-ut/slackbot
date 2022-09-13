/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */
jest.mock('../lib/slackUtils');
jest.mock('../lib/state');

import type {KnownBlock, WebAPICallResult, ViewsOpenArguments} from '@slack/web-api';
// @ts-expect-error
import Slack from '../lib/slackMock.js';
import {RememberEnglish} from '.';

let slack: Slack = null;
let rememberEnglish: MockedRememberEnglish = null;
const postMessage = jest.fn();
const updateMessage = jest.fn();
const viewsOpen = jest.fn();

const now = new Date('2021-01-01').getTime();

class MockedRememberEnglish extends RememberEnglish {
	// eslint-disable-next-line camelcase
	postMessage(message: {text: string, blocks?: KnownBlock[], username?: string, icon_url?: string}) {
		postMessage(message);
		return Promise.resolve({} as WebAPICallResult);
	}

	updateMessage(message: {text: string, ts: string, blocks?: KnownBlock[]}) {
		updateMessage(message);
		return Promise.resolve({} as WebAPICallResult);
	}

	viewsOpen(data: ViewsOpenArguments) {
		viewsOpen(data);
		return Promise.resolve({} as WebAPICallResult);
	}
}

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;

	postMessage.mockClear();
	updateMessage.mockClear();
	viewsOpen.mockClear();

	jest
		.useFakeTimers()
		.setSystemTime(now);

	rememberEnglish = new MockedRememberEnglish(slack);
	await rememberEnglish.initialize();
});

describe('RememberEnglish', () => {
	it('can add word', async () => {
		const word = {ja: 'テスト', en: 'test', user: 'UHOGEHOGE'};
		await rememberEnglish.addWord(word);
		expect(postMessage).toBeCalledWith({
			username: 'Dummy User',
			icon_url: 'https://example.com/dummy.png',
			text: 'Today\'s English: test (テスト)',
		});
		expect(rememberEnglish.dictionary.words).toContainEqual(['test', {en: 'test', ja: 'テスト', createdAt: now}]);
		expect(rememberEnglish.state.words).toContainEqual({en: 'test', ja: 'テスト', createdAt: now});
	});
});
