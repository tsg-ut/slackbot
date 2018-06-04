/* eslint-env node, jest */

const {RTM_EVENTS: {EMOJI_CHANGED}} = require('@slack/client');
const emojiNotifier = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_RANDOM = slack.fakeChannel;
	emojiNotifier(slack);
});

it('responds to emoji addition', () => new Promise((resolve) => {
	slack.on('chat.postMessage', (channel, text, {username, icon_emoji: icon}) => {
		expect(channel).toBe(slack.fakeChannel);
		expect(username).toBe('emoji-notifier');
		expect(text).toContain(':hoge:');
		expect(text).toContain('追加');
		expect(icon).toBe(':hoge:');
		resolve();
	});

	slack.rtmClient.emit(EMOJI_CHANGED, {
		subtype: 'add',
		name: 'hoge',
	});
}));

it('responds to emoji removal', () => new Promise((resolve) => {
	slack.on('chat.postMessage', (channel, text, {username, icon_emoji: icon}) => {
		expect(channel).toBe(slack.fakeChannel);
		expect(username).toBe('emoji-notifier');
		expect(text).toContain(':hoge:');
		expect(text).toContain('削除');
		expect(icon).toBe(':innocent:');
		resolve();
	});

	slack.rtmClient.emit(EMOJI_CHANGED, {
		subtype: 'remove',
		names: ['hoge'],
	});
}));
