const axios = require('axios');
const {stripIndent} = require('common-tags');

module.exports = (clients) => {
	const {eventClient, webClient: slack} = clients;

	const notify = async ({type, channel, user}) => {
		await slack.conversations.join({channel});

		const verb = type === 'create' ? '作成' : 'アーカイブから復元';

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_RANDOM,
			text: stripIndent`
				<@${user}>が<#${channel}>を${verb}しました
			`,
			username: 'channel-notifier',
			// eslint-disable-next-line camelcase
			icon_emoji: ':new:',
		});
	};

	eventClient.on('channel_created', (data) => (
		notify({
			type: 'create',
			channel: data.channel.id,
			user: data.channel.creator,
		})
	));

	eventClient.on('channel_unarchive', (data) => (
		notify({
			type: 'unarchive',
			channel: data.channel,
			user: data.user,
		})
	));
};
