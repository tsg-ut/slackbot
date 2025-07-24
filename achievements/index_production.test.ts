/* eslint-disable no-undef */
import noop from 'lodash/noop';
// @ts-expect-error
import MockFirebase from 'mock-cloud-firestore';
import Slack from '../lib/slackMock';

import achievements from './index_production';

let slack: Slack = null;

jest.mock('../lib/slackUtils');

jest.mock('../lib/state');

jest.mock('../lib/firestore', () => {
	const firebase = new MockFirebase({});
	const db = firebase.firestore();
	db.runTransaction = noop;
	return {db};
});

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	achievements(slack);
});

describe('achievements', () => {
	it('unlock chat achievement when chat is posted', async () => {
		const response = await slack.getResponseTo('hoge');
		// eslint-disable-next-line no-restricted-syntax
		expect('username' in response && response.username).toBe('achievements');
		expect(response.text).toContain('はじめまして!');
	});
});
