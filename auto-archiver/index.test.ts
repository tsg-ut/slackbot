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

	it('should stop working until 2024-06-20T00:00:00Z', async () => {
		const slack = new Slack();
		const listConversations = slack.webClient.conversations.list as jest.MockedFunction<typeof slack.webClient.conversations.list>;
		listConversations.mockResolvedValueOnce({
			channels: [],
			ok: true,
		});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-06-19T23:59:59Z'));

		expect(slack.webClient.conversations.list).not.toBeCalled();
	});

	it('should not remind to archive if message is posted within 90 days', async () => {
		const slack = new Slack();
		const listConversations = slack.webClient.conversations.list as jest.MockedFunction<typeof slack.webClient.conversations.list>;
		listConversations.mockResolvedValueOnce({
			channels: [],
			ok: true,
		});

		const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const MockedState = State as MockedStateInterface<ChannelsStateObj>;
		const state = MockedState.mocks.get('auto-archiver_channels');
		state[FAKE_CHANNEL] = (new Date('2024-06-19T00:00:00Z').getTime() / 1000).toString();

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-06-20T00:01:01Z'));

		expect(slack.webClient.conversations.list).toBeCalled();
		expect(slack.webClient.chat.postMessage).not.toBeCalled();
	});

	it('should remind channel to archive when no public message is posted', async () => {
		const slack = new Slack();

		const listConversations = slack.webClient.conversations.list as jest.MockedFunction<typeof slack.webClient.conversations.list>;
		listConversations.mockResolvedValueOnce({
			channels: [{id: FAKE_CHANNEL, name: 'random'}],
			ok: true,
		});

		const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		const callbackFnPromise = registerScheduleCallback();

		await autoArchiver(slack);

		const callbackFn = await callbackFnPromise;
		await callbackFn(new Date('2024-06-20T00:01:01Z'));

		expect(slack.webClient.conversations.list).toBeCalledWith({
			types: 'public_channel',
		});

		const mockedPostMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		expect(mockedPostMessage).toBeCalledTimes(1);
		expect(mockedPostMessage.mock.calls[0][0].text).toBe([
			'<!channel> このチャンネルには90日以上BOT以外のメッセージが投稿されていません。',
			'引き続きこのチャンネルを使用しますか?',
		].join('\n'));
		expect(mockedPostMessage.mock.calls[0][0].channel).toBe(FAKE_CHANNEL);
		expect(mockedPostMessage.mock.calls[0][0].blocks).toHaveLength(3);

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
		const slack = new Slack();

		const mockedAction = slack.messageClient.action as jest.MockedFunction<typeof slack.messageClient.action>;
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

		const updateMessage = slack.webClient.chat.update as jest.MockedFunction<typeof slack.webClient.chat.update>;
		updateMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		const archiveConversation = slack.webClient.conversations.archive as jest.MockedFunction<typeof slack.webClient.conversations.archive>;
		archiveConversation.mockResolvedValueOnce({
			ok: true,
		});

		await autoArchiver(slack);

		await actionDeferred.promise;

		const mockedUpdateMessage = slack.webClient.chat.update as jest.MockedFunction<typeof slack.webClient.chat.update>;
		expect(mockedUpdateMessage).toBeCalled();
		expect(mockedUpdateMessage.mock.calls[0][0].text).toBe([
			'<!channel> このチャンネルには90日以上BOT以外のメッセージが投稿されていません。',
			'引き続きこのチャンネルを使用しますか?',
		].join('\n'));
		expect(mockedUpdateMessage.mock.calls[0][0].channel).toBe(FAKE_CHANNEL);
		expect(mockedUpdateMessage.mock.calls[0][0].ts).toBe(FAKE_TIMESTAMP);
		expect(mockedUpdateMessage.mock.calls[0][0].blocks).toHaveLength(3);
		expect((mockedUpdateMessage.mock.calls[0][0].blocks[1] as SectionBlock).text.text).toBe('<@U12345678>の回答: ＊使用しない＊');
		expect(slack.webClient.conversations.archive).toBeCalledWith({
			channel: FAKE_CHANNEL,
		});
	});

	it('should snooze channel if user responded with "continue"', async () => {
		const FAKE_NOW = new Date('2024-01-01T00:00:00Z');
		jest.setSystemTime(FAKE_NOW);

		const slack = new Slack();

		const mockedAction = slack.messageClient.action as jest.MockedFunction<typeof slack.messageClient.action>;
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

		const updateMessage = slack.webClient.chat.update as jest.MockedFunction<typeof slack.webClient.chat.update>;
		updateMessage.mockResolvedValueOnce({
			ok: true,
			ts: FAKE_TIMESTAMP,
		});

		await autoArchiver(slack);

		await actionDeferred.promise;

		const mockedUpdateMessage = slack.webClient.chat.update as jest.MockedFunction<typeof slack.webClient.chat.update>;
		expect(mockedUpdateMessage).toBeCalled();
		expect(mockedUpdateMessage.mock.calls[0][0].text).toBe([
			'<!channel> このチャンネルには90日以上BOT以外のメッセージが投稿されていません。',
			'引き続きこのチャンネルを使用しますか?',
		].join('\n'));
		expect(mockedUpdateMessage.mock.calls[0][0].channel).toBe(FAKE_CHANNEL);
		expect(mockedUpdateMessage.mock.calls[0][0].ts).toBe(FAKE_TIMESTAMP);
		expect(mockedUpdateMessage.mock.calls[0][0].blocks).toHaveLength(3);
		expect((mockedUpdateMessage.mock.calls[0][0].blocks[1] as SectionBlock).text.text).toBe('<@U12345678>の回答: ＊使用する＊');

		const MockedState = State as MockedStateInterface<StateObj>;
		const state = MockedState.mocks.get('auto-archiver_state');
		expect(state).not.toBeUndefined();
		expect(state?.snoozes).toHaveLength(1);
		expect(state?.snoozes[0]).toStrictEqual({
			channelId: FAKE_CHANNEL,
			expire: FAKE_NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
		});
	});
});
