/* eslint-env node, jest */

const emojiNotifier = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	emojiNotifier(slack);
});

it('responds to emoji addition', () => {
	const promise = Promise.all([
		new Promise((resolve) => {
			slack.on('chat.postMessage', ({channel, text, username, icon_emoji: icon}) => {
				expect(channel).toBe(slack.fakeChannel);
				expect(username).toContain('emoji-notifier');
				expect(username).toContain('hoge');
				expect(text).toContain(':hoge:');
				expect(text).toContain('追加');
				expect(icon).toBe(':hoge:');
				resolve();
			});
		}),
		new Promise((resolve) => {
			slack.on('reactions.add', ({name}) => {
				expect(name).toBe('hoge');
				resolve();
			});
		}),
	]);
	slack.rtmClient.emit('emoji_changed', {
		subtype: 'add',
		name: 'hoge',
	});

	return promise;
});

it('responds to emoji removal', () => new Promise((resolve) => {
	slack.on('chat.postMessage', ({channel, text, username, icon_emoji: icon}) => {
		expect(channel).toBe(slack.fakeChannel);
		expect(username).toBe('emoji-notifier');
		expect(text).toContain(':hoge:');
		expect(text).toContain('削除');
		expect(icon).toBe(':innocent:');
		resolve();
	});

	slack.rtmClient.emit('emoji_changed', {
		subtype: 'remove',
		names: ['hoge'],
	});
}));
