import {GenericMessageEvent} from '@slack/web-api';
import {ChannelLimitedBot} from './channelLimitedBot';
import Slack from './slackMock';

jest.mock('../lib/slackUtils');

describe('ChannelLimitedBot', () => {
	let slack: Slack;

	beforeEach(() => {
		jest.clearAllMocks();
		slack = new Slack();
		process.env.CHANNEL_GAMES = slack.fakeChannel;
		process.env.HAKATASHI_TOKEN = 'xoxb-hakatashi-token';

		(slack.webClient.chat.getPermalink as jest.Mock).mockResolvedValue({
			ok: true,
			permalink: 'https://slack.com/archives/CHANNEL_ID/p1234567890123456',
		});
		(slack.webClient.chat.postEphemeral as jest.Mock).mockResolvedValue({
			ok: true,
			message_ts: '12345.6789',
		});
		(slack.webClient.chat.postMessage as jest.Mock).mockResolvedValue({
			ok: true,
			ts: 'progress.123',
		});
		(slack.webClient.chat.delete as jest.Mock).mockResolvedValue({
			ok: true,
		});
	});

	it('responds to messages containing the wake word in the allowed channel', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
		}
		new TestBot(slack);

		onWakeWord.mockResolvedValueOnce('12345.6789');

		slack.postMessage('wakeword in allowed channel', {channel: slack.fakeChannel});

		expect(onWakeWord).toHaveBeenCalledTimes(1);
		expect(onWakeWord).toHaveBeenCalledWith(
			expect.objectContaining({text: 'wakeword in allowed channel'}),
			slack.fakeChannel,
		);
	});

	it('posts ephemeral message and deletes original when wake word is used in disallowed channel (null response)', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();
		const disallowedChannel = 'C9876543210';

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
			protected override progressMessageChannel: string | undefined = undefined;
		}
		new TestBot(slack);

		onWakeWord.mockResolvedValueOnce(null);

		slack.postMessage('wakeword in disallowed channel', {channel: disallowedChannel});

		await new Promise(setImmediate);

		expect(onWakeWord).toHaveBeenCalledTimes(1);
		expect(onWakeWord).toHaveBeenCalledWith(
			expect.objectContaining({text: 'wakeword in disallowed channel'}),
			slack.fakeChannel,
		);

		expect(slack.webClient.chat.postEphemeral).toHaveBeenCalledWith({
			channel: disallowedChannel,
			user: slack.fakeUser,
			text: 'このチャンネルではBOTを実行できません。',
		});

		expect(slack.webClient.chat.delete).toHaveBeenCalledWith({
			token: 'xoxb-hakatashi-token',
			channel: disallowedChannel,
			ts: slack.fakeTimestamp,
		});
	});

	it('posts ephemeral message with permalink and deletes original when wake word is used in disallowed channel (with response)', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();
		const disallowedChannel = 'C9876543210';
		const responseTs = '12345.6789';
		const progressChannel = 'CPROGRESS';

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
			protected override progressMessageChannel = progressChannel;
		}
		new TestBot(slack);

		onWakeWord.mockResolvedValueOnce(responseTs);

		slack.postMessage('wakeword in disallowed channel', {channel: disallowedChannel});

		await new Promise(setImmediate);

		expect(onWakeWord).toHaveBeenCalledTimes(1);

		expect(slack.webClient.chat.getPermalink).toHaveBeenCalledWith({
			channel: slack.fakeChannel,
			message_ts: responseTs,
		});

		expect(slack.webClient.chat.postEphemeral).toHaveBeenCalledWith({
			channel: disallowedChannel,
			user: slack.fakeUser,
			text: 'このチャンネルではBOTを実行できません。代わりに<https://slack.com/archives/CHANNEL_ID/p1234567890123456|こちら>で実行しました。',
		});

		expect(slack.webClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
			channel: progressChannel,
			text: '<https://slack.com/archives/CHANNEL_ID/p1234567890123456|進行中のゲーム>があります！',
		}));

		expect(slack.webClient.chat.delete).toHaveBeenCalledWith({
			token: process.env.HAKATASHI_TOKEN,
			channel: disallowedChannel,
			ts: slack.fakeTimestamp,
		});
	});

	it('ignores messages without the wake word', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
		}
		new TestBot(slack);

		slack.postMessage('no trigger here', {channel: slack.fakeChannel});

		expect(onWakeWord).not.toHaveBeenCalled();
	});

	it('ignores messages from bots', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
		}
		new TestBot(slack);

		slack.postMessage('wakeword from bot', {
			channel: slack.fakeChannel,
			bot_id: 'B12345678',
		});

		expect(onWakeWord).not.toHaveBeenCalled();
	});

	it('ignores messages without user', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
		}
		new TestBot(slack);

		slack.eventClient.emit('message', {
			type: 'message',
			channel: slack.fakeChannel,
			text: 'wakeword without user',
			ts: '1234567890.123456',
		});

		expect(onWakeWord).not.toHaveBeenCalled();
	});

	it('ignores messages without text', async () => {
		const onWakeWord = jest.fn<Promise<string | null>, [GenericMessageEvent, string]>();

		class TestBot extends ChannelLimitedBot {
			protected override wakeWordRegex = /wakeword/;
			protected override allowedChannels = [slack.fakeChannel];
			protected override onWakeWord = onWakeWord;
		}
		new TestBot(slack);

		slack.eventClient.emit('message', {
			type: 'message',
			channel: slack.fakeChannel,
			user: 'U12345678',
			ts: '1234567890.123456',
		});

		expect(onWakeWord).not.toHaveBeenCalled();
	});
});