const {stripIndent} = require('common-tags');
const axios = require('axios');

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on('channel_created', async (data) => {
		await axios.post('https://slack.com/api/channels.invite', {
			channel: data.channel.id,
			user: process.env.USER_TSGBOT,
		}, {
			headers: {
				Authorization: `Bearer ${process.env.HAKATASHI_TOKEN}`,
			},
		});

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
