/* eslint-env node, jest */

const channelNotifier = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_RANDOM = slack.fakeChannel;
	channelNotifier(slack);
});

it('responds to channel creation', () => new Promise((resolve) => {
	Promise.all([
		new Promise((resolve) => {
			slack.on('channels.join', ({name}) => {
				expect(name).toBe('#fun');
				resolve();
			});
		}),
		new Promise((resolve) => {
			slack.on('chat.postMessage', ({channel, text, username, icon_emoji: icon}) => {
				expect(channel).toBe(slack.fakeChannel);
				expect(username).toBe('channel-notifier');
				expect(text).toContain('fun');
				expect(text).toContain('作成');
				expect(icon).toBe(':new:');
				resolve();
			});
		}),
	]).then(resolve);

	// https://api.slack.com/events/channel_created
	slack.rtmClient.emit('channel_created', {
		channel: {
			id: 'C024BE91L',
			name: 'fun',
			created: 1360782804,
			creator: 'U024BE7LH',
		},
	});
}));
