/* eslint-disable private-props/no-use-outside */
/* eslint-disable no-underscore-dangle */
/* eslint-env jest */

import noop from 'lodash/noop';
// @ts-expect-error: MockFirebase does not have types
import MockFirebase from 'mock-cloud-firestore';
// @ts-expect-error: Fake firebase import for testing
import {fixtures} from '../lib/firestore';
import Slack from '../lib/slackMock';
import achievements, {unlock} from './index_production';

let slack: Slack = null;

jest.mock('../lib/slackUtils');

jest.mock('../lib/state');

jest.mock('../lib/firestore', () => {
	const fixtureData = {};
	const firebase = new MockFirebase(fixtureData);
	const db = firebase.firestore();
	db.runTransaction = noop;
	return {db, fixtures: fixtureData};
});

describe('achievements', () => {
	const FAKE_TIMESTAMP = '12345678.123456';
	const FAKE_DATE = new Date('2020-01-01T00:00:00Z');
	const FAKE_USER = 'U12345678';

	jest.useFakeTimers();

	beforeEach(() => {
		jest.clearAllMocks();
		delete fixtures.__collection__;

		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		achievements(slack);
	});

	it('unlock chat achievement when chat is posted', async () => {
		const response = await slack.getResponseTo('hoge');
		// eslint-disable-next-line no-restricted-syntax
		expect('username' in response && response.username).toBe('achievements');
		expect(response.text).toContain('はじめまして!');
	});

	it('unlock achievement when unlock function is called', async () => {
		jest.setSystemTime(FAKE_DATE);

		const postMessage = jest.mocked(slack.webClient.chat.postMessage);
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		await unlock(FAKE_USER, 'pwnyaa-tw-half');

		const unlockedAchievements = Object.values(fixtures?.__collection__?.achievements?.__doc__ ?? {});
		expect(unlockedAchievements).toHaveLength(2);
		expect(unlockedAchievements).toContainEqual({
			user: FAKE_USER,
			date: FAKE_DATE,
			__isDirty__: false,
			name: 'pwnyaa-tw-half',
		});
		expect(unlockedAchievements).toContainEqual({
			user: FAKE_USER,
			date: FAKE_DATE,
			__isDirty__: false,
			name: 'achievements',
		});
	});
});
