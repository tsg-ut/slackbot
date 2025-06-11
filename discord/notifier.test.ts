/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */

jest.mock('../lib/state');
jest.mock('../lib/slack');
jest.mock('../lib/slackUtils');
jest.mock('node-schedule', () => ({
	scheduleJob: jest.fn(),
}));

import {GuildMember, User, VoiceChannel, VoiceState} from 'discord.js';
import Slack from '../lib/slackMock';
import {Notifier} from './notifier';

describe('discord', () => {
	describe('Notifier', () => {
		const FAKE_SANDBOX = 'C12345678';
		const FAKE_DISCORD = 'C87654321';

		const TEST_MEMBER = {
			user: {
				id: '1234567890',
				displayAvatarURL: () => 'https://example.com/avatar.png',
				bot: false,
			} as User,
			displayName: 'test-user',
		} as GuildMember;

		const TEST_MEMBER_2 = {
			user: {
				id: '2345678901',
				displayAvatarURL: () => 'https://example.com/avatar.png',
				bot: false,
			} as User,
			displayName: 'test-user-2',
		} as GuildMember;

		const TEST_MEMBER_3 = {
			user: {
				id: '3456789012',
				displayAvatarURL: () => 'https://example.com/avatar.png',
				bot: false,
			} as User,
			displayName: 'test-user-3',
		} as GuildMember;

		const BOT_MEMBER = {
			user: {
				id: '0987654321',
				displayAvatarURL: () => 'https://example.com/avatar.png',
				bot: true,
			} as User,
			displayName: 'bot-user',
		} as GuildMember;

		const TEST_CHANNEL = {
			id: '0123456789',
			name: 'test-channel',
			members: new Map([
				['1234567890', TEST_MEMBER],
			]),
		} as VoiceChannel;

		const TEST_CHANNEL_2 = {
			id: '0123456789',
			name: 'test-channel',
			members: new Map([
				['1234567890', TEST_MEMBER],
				['2345678901', TEST_MEMBER_2],
			]),
		} as VoiceChannel;

		const TEST_CHANNEL_3 = {
			id: '0123456789',
			name: 'test-channel',
			members: new Map([
				['1234567890', TEST_MEMBER],
				['2345678901', TEST_MEMBER_2],
				['3456789012', TEST_MEMBER_3],
			]),
		} as VoiceChannel;

		const EMPTY_CHANNEL_STATE = {
			channel: null,
			member: TEST_MEMBER,
		} as VoiceState;

		const JOINED_CHANNEL_STATE = {
			channel: TEST_CHANNEL,
			member: TEST_MEMBER,
		} as VoiceState;

		const EMPTY_BOT_CHANNEL_STATE = {
			channel: null,
			member: BOT_MEMBER,
		} as VoiceState;

		const JOINED_BOT_CHANNEL_STATE = {
			channel: TEST_CHANNEL,
			member: BOT_MEMBER,
		} as VoiceState;

		it('should handle voice state update of joining and notify channels', async () => {
			process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
			process.env.CHANNEL_DISCORD = FAKE_DISCORD;

			const slack = new Slack();

			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockResolvedValue({
				ok: true,
				ts: '123456789.123456',
			});

			const notifier = new Notifier(slack.webClient);

			await notifier.voiceStateUpdate(EMPTY_CHANNEL_STATE, JOINED_CHANNEL_STATE);

			const expectedContent = {
				blocks: [
					{
						text: {
							text: '＊test-user＊がtest-channelにログインしました',
							type: 'mrkdwn',
						},
						type: 'section',
					},
					{
						elements: [
							{
								text: '*[test-channel]*',
								type: 'mrkdwn',
							},
							{
								alt_text: 'test-user',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								emoji: true,
								text: '1 users',
								type: 'plain_text',
							},
						],
						type: 'context',
					},
				],
				icon_emoji: ':discord:',
				text: '＊test-user＊がtest-channelにログインしました\n現在のアクティブ人数 1人',
				username: 'Discord',
			};

			expect(slack.webClient.chat.postMessage).toBeCalledWith({
				channel: FAKE_SANDBOX,
				...expectedContent,
			});

			expect(slack.webClient.chat.postMessage).toBeCalledWith({
				channel: FAKE_DISCORD,
				...expectedContent,
			});
		});

		it('should handle voice state update of leaving and notify channels', async () => {
			process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
			process.env.CHANNEL_DISCORD = FAKE_DISCORD;

			const slack = new Slack();

			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockResolvedValue({
				ok: true,
				ts: '123456789.123456',
			});

			const notifier = new Notifier(slack.webClient);

			await notifier.voiceStateUpdate(JOINED_CHANNEL_STATE, EMPTY_CHANNEL_STATE);

			const expectedContent = {
				blocks: [
					{
						text: {
							text: '＊test-user＊がtest-channelからログアウトしました',
							type: 'mrkdwn',
						},
						type: 'section',
					},
					{
						elements: [
							{
								text: '*[test-channel]*',
								type: 'mrkdwn',
							},
							{
								alt_text: 'test-user',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								emoji: true,
								text: '1 users',
								type: 'plain_text',
							},
						],
						type: 'context',
					},
				],
				icon_emoji: ':discord:',
				text: '＊test-user＊がtest-channelからログアウトしました\n現在のアクティブ人数 1人',
				username: 'Discord',
			};

			expect(slack.webClient.chat.postMessage).toBeCalledWith({
				channel: FAKE_SANDBOX,
				...expectedContent,
			});

			expect(slack.webClient.chat.postMessage).toBeCalledWith({
				channel: FAKE_DISCORD,
				...expectedContent,
			});
		});

		it('should not notify when member is bot', async () => {
			process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
			process.env.CHANNEL_DISCORD = FAKE_DISCORD;

			const slack = new Slack();

			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockResolvedValue({ok: false});

			const notifier = new Notifier(slack.webClient);

			await notifier.voiceStateUpdate(EMPTY_BOT_CHANNEL_STATE, JOINED_BOT_CHANNEL_STATE);

			expect(slack.webClient.chat.postMessage).not.toBeCalled();
		});

		it('should erase message when next message is sent', async () => {
			process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
			process.env.CHANNEL_DISCORD = FAKE_DISCORD;

			const slack = new Slack();

			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockImplementation((message) => {
				if (message.channel === FAKE_SANDBOX) {
					return Promise.resolve({
						ok: true,
						ts: '123456789.123456',
					});
				}
				return Promise.resolve({
					ok: true,
					ts: '987654321.123456',
				});
			});

			const notifier = new Notifier(slack.webClient);

			await notifier.voiceStateUpdate(EMPTY_CHANNEL_STATE, JOINED_CHANNEL_STATE);

			const deleteMessage = slack.webClient.chat.delete as jest.MockedFunction<typeof slack.webClient.chat.delete>;
			deleteMessage.mockResolvedValue({ok: true});

			await notifier.voiceStateUpdate(JOINED_CHANNEL_STATE, EMPTY_CHANNEL_STATE);

			expect(slack.webClient.chat.delete).toBeCalledTimes(1);
			expect(slack.webClient.chat.delete).toBeCalledWith({
				channel: FAKE_SANDBOX,
				ts: '123456789.123456',
			});
		});

		it('should summarize discord events when multiple events are sent', async () => {
			process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
			process.env.CHANNEL_DISCORD = FAKE_DISCORD;

			const slack = new Slack();

			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockResolvedValue({
				ok: true,
				ts: '123456789.123456',
			});

			const notifier = new Notifier(slack.webClient);

			await notifier.voiceStateUpdate({
				channel: null,
				member: TEST_MEMBER,
			} as VoiceState, {
				channel: TEST_CHANNEL,
				member: TEST_MEMBER,
			} as VoiceState);

			await notifier.voiceStateUpdate({
				channel: null,
				member: TEST_MEMBER_2,
			} as VoiceState, {
				channel: TEST_CHANNEL_2,
				member: TEST_MEMBER_2,
			} as VoiceState);

			await notifier.voiceStateUpdate({
				channel: null,
				member: TEST_MEMBER_3,
			} as VoiceState, {
				channel: TEST_CHANNEL_3,
				member: TEST_MEMBER_3,
			} as VoiceState);

			expect(slack.webClient.chat.postMessage).toBeCalledWith({
				channel: FAKE_SANDBOX,
				blocks: [
					{
						text: {
							text: '＊test-user＊, ＊test-user-2＊, ＊test-user-3＊がtest-channelにログインしました',
							type: 'mrkdwn',
						},
						type: 'section',
					},
					{
						elements: [
							{
								text: '*[test-channel]*',
								type: 'mrkdwn',
							},
							{
								alt_text: 'test-user',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								alt_text: 'test-user-2',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								alt_text: 'test-user-3',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								emoji: true,
								text: '3 users',
								type: 'plain_text',
							},
						],
						type: 'context',
					},
				],
				icon_emoji: ':discord:',
				text: '＊test-user＊, ＊test-user-2＊, ＊test-user-3＊がtest-channelにログインしました\n現在のアクティブ人数 3人',
				username: 'Discord',
			});

			expect(slack.webClient.chat.postMessage).toBeCalledWith({
				channel: FAKE_DISCORD,
				blocks: [
					{
						text: {
							text: '＊test-user-3＊がtest-channelにログインしました',
							type: 'mrkdwn',
						},
						type: 'section',
					},
					{
						elements: [
							{
								text: '*[test-channel]*',
								type: 'mrkdwn',
							},
							{
								alt_text: 'test-user',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								alt_text: 'test-user-2',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								alt_text: 'test-user-3',
								image_url: 'https://example.com/avatar.png',
								type: 'image',
							},
							{
								emoji: true,
								text: '3 users',
								type: 'plain_text',
							},
						],
						type: 'context',
					},
				],
				icon_emoji: ':discord:',
				text: '＊test-user-3＊がtest-channelにログインしました\n現在のアクティブ人数 3人',
				username: 'Discord',
			});
		});
	});
});
