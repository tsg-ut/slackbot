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

		const TEST_CHANNEL = {
			id: '0123456789',
			name: 'test-channel',
			members: new Map([
				['1234567890', TEST_MEMBER],
			]),
		} as VoiceChannel;

		const EMPTY_CHANNEL_STATE = {
			channel: null,
			member: TEST_MEMBER,
		} as VoiceState;

		const TEST_CHANNEL_STATE = {
			channel: TEST_CHANNEL,
			member: TEST_MEMBER,
		} as VoiceState;

		it('should record latest message timestamp of each channel', async () => {
			process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
			process.env.CHANNEL_DISCORD = FAKE_DISCORD;

			const slack = new Slack();

			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			postMessage.mockResolvedValueOnce({
				ok: true,
				message: {
					ts: '123456789.123456',
				},
			});

			const notifier = new Notifier(slack.webClient);

			await notifier.voiceStateUpdate(EMPTY_CHANNEL_STATE, TEST_CHANNEL_STATE);

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
	});
});
