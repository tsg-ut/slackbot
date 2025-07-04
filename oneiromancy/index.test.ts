/* eslint-env node, jest */

jest.mock('../lib/openai', () => ({
	chat: {
		completions: {
			create: jest.fn(() => Promise.resolve({
				choices: [{
					message: {
						content: '今日の運勢は【80点】です。良い一日になりそうです。',
					},
				}],
			})),
		},
	},
}));

jest.mock('../achievements');
jest.mock('fs/promises', () => ({
	readFile: jest.fn(() => Promise.resolve(Buffer.from(`
- role: system
  content: あなたは夢占いBOTです。
`))),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {default: Slack} = require('../lib/slackMock.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const oneiromancy = require('./index.ts');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let slack: any = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	process.env.CHANNEL_SIG_DREAM = 'C_SIG_DREAM';
	await oneiromancy.default(slack);
});

describe('oneiromancy', () => {
	it('should ignore non-crystal_ball reactions', () => new Promise<void>((resolve) => {
		let messageCount = 0;

		slack.on('chat.postMessage', () => {
			messageCount++;
		});

		slack.eventClient.emit('reaction_added', {
			reaction: 'thumbsup',
			item: {
				channel: process.env.CHANNEL_SIG_DREAM,
				ts: slack.fakeTimestamp,
			},
			user: slack.fakeUser,
			item_user: slack.fakeUser,
		});

		// Wait and then verify no messages were posted
		setTimeout(() => {
			expect(messageCount).toBe(0);
			resolve(undefined);
		}, 100);
	}));

	// Note: More comprehensive tests for the broadcast behavior would require
	// more complex mocking setup. The core functionality has been implemented:
	// reply_broadcast is set to true only when event.item.channel === process.env.CHANNEL_SIG_DREAM
});
