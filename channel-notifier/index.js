const {stripIndent} = require('common-tags');

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on('channel_created', async (data) => {
		await slack.channels.join({name: `#${data.channel.name}`});
		await slack.chat.postMessage({
			channel: process.env.CHANNEL_RANDOM,
			text: stripIndent`
				<@${data.channel.creator}> が <#${data.channel.id}|${data.channel.name}> を作成しました
			`,
			username: 'channel-notifier',
			// eslint-disable-next-line camelcase
			icon_emoji: ':new:',
		});
	});
};
