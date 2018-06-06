const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const {stripIndent} = require('common-tags');
const schedule = require('node-schedule');
const axios = require('axios');
const get = require('lodash/get');

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		herenow: null,
	};

	const job = async () => {
		if (!process.env.SWARM_TOKEN) {
			console.log('Skipping checkin job because SWARM_TOKEN is not set');
			return;
		}

		const data = await axios.get('https://api.foursquare.com/v2/venues/4bff8900daf9c9b68c58faef/herenow', {
			params: {
				oauth_token: process.env.SWARM_TOKEN,
				v: '20180606',
			},
			responseType: 'json',
		});

		const items = get(data, ['data', 'response', 'hereNow', 'items'], []);

		if (state.herenow !== null) {
			const newUsers = items.filter(({id}) => state.herenow.find((user) => user.id === id) === undefined)

			for (const {user, shout} of newUsers) {
				await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, stripIndent`
					\`${user.firstName} ${user.lastName}\` が理学部7号館にチェックインしました
					${shout ? `「${shout}」` : ''}
				`, {
					username: 'checkin',
					icon_url: `${user.photo.prefix}110x110${user.photo.suffix}`,
				});
			}
		}

		state.herenow = items;
	};

	schedule.scheduleJob('*/3 * * * *', job);

	rtm.on(MESSAGE, (message) => {
		if (message.text === 'checkin-check' && message.channel === process.env.CHANNEL_SANDBOX) {
			job();
		}
	});
};
