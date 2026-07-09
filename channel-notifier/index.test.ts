vi.mock('axios');

import Slack from '../lib/slackMock.js';
import channelNotifier from './index.js';

let slack: any = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_RANDOM = slack.fakeChannel;
	channelNotifier(slack);
});

describe('channel-notifier', () => {
	it('responds to channel creation', () => new Promise<void>((resolve) => {
		slack.on('chat.postMessage', ({channel, text, username}: any) => {
			expect(channel).toBe(slack.fakeChannel);
			expect(username).toBe('channel-notifier');
			expect(text).toContain('U024BE7LH');
			expect(text).toContain('C024BE91L');
			expect(text).toContain('作成');
			resolve();
		});

		// https://api.slack.com/events/channel_created
		slack.eventClient.emit('channel_created', {
			channel: {
				id: 'C024BE91L',
				name: 'fun',
				created: 1360782804,
				creator: 'U024BE7LH',
			},
		});
	}));

	it('responds to channel unarchive', () => new Promise<void>((resolve) => {
		slack.on('chat.postMessage', ({channel, text, username}: any) => {
			expect(channel).toBe(slack.fakeChannel);
			expect(username).toBe('channel-notifier');
			expect(text).toContain('U024BE7LH');
			expect(text).toContain('C024BE91L');
			expect(text).toContain('復元');
			resolve();
		});

		// https://api.slack.com/events/channel_unarchiveu
		slack.eventClient.emit('channel_unarchive', {
			type: 'channel_unarchive',
			channel: 'C024BE91L',
			user: 'U024BE7LH',
		});
	}));
});
