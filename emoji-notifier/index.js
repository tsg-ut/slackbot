const {RTM_EVENTS: {EMOJI_CHANGED}} = require('@slack/client');
const {stripIndent} = require('common-tags');

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on(EMOJI_CHANGED, async (data) => {
		if (data.subtype === 'add') {
			await slack.chat.postMessage(process.env.CHANNEL_RANDOM, stripIndent`
				絵文字 \`:${data.name}:\` が追加されました :+1::tada::muscle::raised_hands::innocent:
			`, {
				username: 'emoji-notifier',
				// eslint-disable-next-line camelcase
				icon_emoji: `:${data.name}:`,
			});
		}

		if (data.subtype === 'remove') {
			await slack.chat.postMessage(process.env.CHANNEL_RANDOM, stripIndent`
				絵文字 ${data.names.map((name) => `\`:${name}:\``).join(' ')} が削除されました :cry::broken_heart::x::fearful::innocent:
			`, {
				username: 'emoji-notifier',
				// eslint-disable-next-line camelcase
				icon_emoji: ':innocent:',
			});
		}
	});
};
