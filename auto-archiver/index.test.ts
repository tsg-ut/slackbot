/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */

jest.mock('../lib/state');
jest.mock('../lib/slack');
jest.mock('../lib/slackUtils');
jest.mock('node-schedule', () => ({
	scheduleJob: jest.fn(),
}));

import {SectionBlock} from '@slack/web-api';
import {noop} from 'lodash';
import schedule, {Job, JobCallback} from 'node-schedule';
import {MockedStateInterface} from '../lib/__mocks__/state';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {Deferred} from '../lib/utils';
import autoArchiver, {ChannelsStateObj, StateObj} from './index';

describe('auto-archiver', () => {
	const FAKE_CHANNEL = 'C12345678';
	const FAKE_CHANNEL2 = 'C23456789';
	const FAKE_TIMESTAMP = '12345678.123456';
	const FAKE_USER = 'U12345678';

	jest.useFakeTimers();

	const registerScheduleCallback = () => {
		const scheduleMock = schedule as jest.Mocked<typeof schedule>;
		const deferred = new Deferred<JobCallback>();

		scheduleMock.scheduleJob.mockImplementationOnce((rule, fn) => {
			expect(rule).toBe('0 9 * * *');

			deferred.resolve(fn);

			return {} as Job;
		});

		return deferred.promise;
	};

	it('should record latest message timestamp of each channel', async () => {
		const slack = new Slack();

		await autoArchiver(slack);

		slack.eventClient.emit('message', {
			channel: FAKE_CHANNEL,
			text: 'test',
			user: FAKE_USER,
			ts: FAKE_TIMESTAMP,
		});

		const MockedState = State as MockedStateInterface<ChannelsStateObj>;
		const state = MockedState.mocks.get('auto-archiver_channels');
		expect(state[FAKE_CHANNEL]).toBe(FAKE_TIMESTAMP);
	});

	it('should schedule job', async () => {
		const slack = new Slack();

		await autoArchiver(slack);

		expect(schedule.scheduleJob).toBeCalled();
	});

	it('should stop working until 2024-08-11T00:00:00Z', async () => {
		const slack = new Slack();
		const listConversations = jest.mocked(slack.webClient.conversations.list);
		listConversations.mockResolvedValueOnce({
			channels: [],
			ok: true,
			response_metadata: {},
		});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-08-10T23:59:59Z'));

		expect(slack.webClient.conversations.list).not.toBeCalled();
	});

	it('should not remind to archive if message is posted within 90 days', async () => {
		const slack = new Slack();
		const listConversations = jest.mocked(slack.webClient.conversations.list);
		listConversations.mockResolvedValueOnce({
			channels: [],
			ok: true,
			response_metadata: {},
		});

		const postMessage = jest.mocked(slack.webClient.chat.postMessage);
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const MockedState = State as MockedStateInterface<ChannelsStateObj>;
		const state = MockedState.mocks.get('auto-archiver_channels');
		state[FAKE_CHANNEL] = (new Date('2024-08-11T00:00:00Z').getTime() / 1000).toString();

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-08-11T00:00:01Z'));

		expect(slack.webClient.conversations.list).toBeCalled();
		expect(slack.webClient.chat.postMessage).not.toBeCalled();
	});

	it('should remind channel to archive when no public message is posted', async () => {
		const slack = new Slack();

		const listConversations = jest.mocked(slack.webClient.conversations.list);
		listConversations.mockResolvedValueOnce({
			channels: [{id: FAKE_CHANNEL, name: 'random'}],
			ok: true,
			response_metadata: {},
		});

		const postMessage = jest.mocked(slack.webClient.chat.postMessage);
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-08-11T00:00:01Z'));

		expect(slack.webClient.conversations.list).toBeCalledWith({
			types: 'public_channel',
			limit: 1000,
		});

		const mockedPostMessage = jest.mocked(slack.webClient.chat.postMessage);
		expect(mockedPostMessage).toBeCalledTimes(1);
		expect(mockedPostMessage.mock.calls[0][0].text).toBe([
			'<!channel> このチャンネルには90日以上BOT以外のメッセージが投稿されていません。',
			'引き続きこのチャンネルを使用しますか?',
		].join('\n'));
		expect(mockedPostMessage.mock.calls[0][0].channel).toBe(FAKE_CHANNEL);
		// eslint-disable-next-line no-restricted-syntax
		const blocks = 'blocks' in mockedPostMessage.mock.calls[0][0] ? mockedPostMessage.mock.calls[0][0].blocks : [];
		expect(blocks).toHaveLength(3);

		const MockedState = State as MockedStateInterface<StateObj>;
		const state = MockedState.mocks.get('auto-archiver_state');
		expect(state).not.toBeUndefined();
		expect(state?.notices).toHaveLength(1);
		expect(state?.notices[0]).toStrictEqual({
			channelId: FAKE_CHANNEL,
			ts: FAKE_TIMESTAMP,
		});
	});

	it('should archive channel if user responded with "stop"', async () => {
		const FAKE_TOKEN = 'xoxt-1234-5678-91011';
		process.env.HAKATASHI_TOKEN = FAKE_TOKEN;

		const slack = new Slack();

		const mockedAction = jest.mocked(slack.messageClient.action);
		const actionDeferred = new Deferred();
		mockedAction.mockImplementation((options, callbackFn) => {
			if (typeof options !== 'object' || options instanceof RegExp) {
				throw new Error('Invalid argument');
			}

			if (options.type === 'button' && options.blockId === 'archive_proposal_actions') {
				callbackFn({
					channel: {
						id: FAKE_CHANNEL,
					},
					message: {
						ts: FAKE_TIMESTAMP,
					},
					user: {
						id: FAKE_USER,
					},
					actions: [
						{
							value: 'stop',
							text: {
								text: '使用しない',
							},
						},
					],
				}, noop as any).then(() => {
					actionDeferred.resolve(null);
				});
				return slack.messageClient;
			}

			throw new Error('Invalid argument');
		});

		const updateMessage = jest.mocked(slack.webClient.chat.update);
		updateMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		const archiveConversation = jest.mocked(slack.webClient.conversations.archive);
		archiveConversation.mockResolvedValueOnce({
			ok: true,
		});

		await autoArchiver(slack);

		await actionDeferred.promise;

		const mockedUpdateMessage = jest.mocked(slack.webClient.chat.update);
		expect(mockedUpdateMessage).toBeCalled();
		expect(mockedUpdateMessage.mock.calls[0][0].text).toBe([
			'<!channel> このチャンネルには90日以上BOT以外のメッセージが投稿されていません。',
			'引き続きこのチャンネルを使用しますか?',
		].join('\n'));
		expect(mockedUpdateMessage.mock.calls[0][0].channel).toBe(FAKE_CHANNEL);
		expect(mockedUpdateMessage.mock.calls[0][0].ts).toBe(FAKE_TIMESTAMP);
		// eslint-disable-next-line no-restricted-syntax
		const blocks = 'blocks' in mockedUpdateMessage.mock.calls[0][0] ? mockedUpdateMessage.mock.calls[0][0].blocks : [];
		expect(blocks).toHaveLength(3);
		expect((blocks[1] as SectionBlock).text.text).toBe('<@U12345678>の回答: ＊使用しない＊');
		expect(slack.webClient.conversations.archive).toBeCalledWith({
			channel: FAKE_CHANNEL,
			token: FAKE_TOKEN,
		});
	});

	it('should handle pagination when fetching channels', async () => {
		const slack = new Slack();

		const listConversations = jest.mocked(slack.webClient.conversations.list);

		listConversations
			.mockResolvedValueOnce({
				channels: [{id: FAKE_CHANNEL, name: 'channel1'}],
				ok: true,
				response_metadata: {
					next_cursor: 'cursor123',
				},
			})
			.mockResolvedValueOnce({
				channels: [{id: FAKE_CHANNEL2, name: 'random'}],
				ok: true,
				response_metadata: {},
			});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-08-11T00:00:01Z'));

		expect(slack.webClient.conversations.list).toHaveBeenCalledTimes(2);
		expect(slack.webClient.conversations.list).toHaveBeenNthCalledWith(1, {
			types: 'public_channel',
			limit: 1000,
		});
		expect(slack.webClient.conversations.list).toHaveBeenNthCalledWith(2, {
			types: 'public_channel',
			limit: 1000,
			cursor: 'cursor123',
		});
	});

	it('should snooze channel if user responded with "continue"', async () => {
		const FAKE_NOW = new Date('2024-01-01T00:00:00Z');
		jest.setSystemTime(FAKE_NOW);

		const slack = new Slack();

		const mockedAction = jest.mocked(slack.messageClient.action);
		const actionDeferred = new Deferred();
		mockedAction.mockImplementation((options, callbackFn) => {
			if (typeof options !== 'object' || options instanceof RegExp) {
				throw new Error('Invalid argument');
			}

			if (options.type === 'button' && options.blockId === 'archive_proposal_actions') {
				callbackFn({
					channel: {
						id: FAKE_CHANNEL,
					},
					message: {
						ts: FAKE_TIMESTAMP,
					},
					user: {
						id: FAKE_USER,
					},
					actions: [
						{
							value: 'continue',
							text: {
								text: '使用する',
							},
						},
					],
				}, noop as any).then(() => {
					actionDeferred.resolve(null);
				});
				return slack.messageClient;
			}

			throw new Error('Invalid argument');
		});

		const updateMessage = jest.mocked(slack.webClient.chat.update);
		updateMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		await autoArchiver(slack);

		await actionDeferred.promise;

		const mockedUpdateMessage = jest.mocked(slack.webClient.chat.update);
		expect(mockedUpdateMessage).toBeCalled();
		expect(mockedUpdateMessage.mock.calls[0][0].text).toBe([
			'<!channel> このチャンネルには90日以上BOT以外のメッセージが投稿されていません。',
			'引き続きこのチャンネルを使用しますか?',
		].join('\n'));
		expect(mockedUpdateMessage.mock.calls[0][0].channel).toBe(FAKE_CHANNEL);
		expect(mockedUpdateMessage.mock.calls[0][0].ts).toBe(FAKE_TIMESTAMP);
		// eslint-disable-next-line no-restricted-syntax
		const blocks = 'blocks' in mockedUpdateMessage.mock.calls[0][0] ? mockedUpdateMessage.mock.calls[0][0].blocks : [];
		expect(blocks).toHaveLength(3);
		expect((blocks[1] as SectionBlock).text.text).toBe('<@U12345678>の回答: ＊使用する＊');

		const MockedState = State as MockedStateInterface<StateObj>;
		const state = MockedState.mocks.get('auto-archiver_state');
		expect(state).not.toBeUndefined();
		expect(state?.snoozes).toHaveLength(1);
		expect(state?.snoozes[0]).toStrictEqual({
			channelId: FAKE_CHANNEL,
			expire: FAKE_NOW.getTime() + 90 * 24 * 60 * 60 * 1000,
		});
	});
});
