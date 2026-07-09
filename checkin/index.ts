import axios from 'axios';
import {stripIndent} from 'common-tags';
import {get} from 'lodash-es';
import schedule from 'node-schedule';
import logger from '../lib/logger.js';
import type {SlackInterface} from '../lib/slack.js';
import type {MessageEvent} from '@slack/bolt';

interface User {
	firstName: string;
	lastName: string;
	photo: {
		prefix: string;
		suffix: string;
	};
}

interface HereNowItem {
	id: string;
	user: User;
	shout?: string;
}

const log = logger.child({bot: 'checkin'});

const places = [
	{id: '4bff8900daf9c9b68c58faef', name: '理学部7号館'},
	{id: '5b1a2ff17269fe002ce4f8de', name: 'TSG部室'},
];

export default ({eventClient, webClient: slack}: SlackInterface) => {
	const state = {
		herenow: new Map<string, HereNowItem[]>(),
	};

	const job = async () => {
		if (!process.env.SWARM_TOKEN) {
			log.info('Skipping checkin job because SWARM_TOKEN is not set');
			return;
		}

		for (const place of places) {
			const data = await axios.get(`https://api.foursquare.com/v2/venues/${place.id}/herenow`, {
				params: {
					oauth_token: process.env.SWARM_TOKEN,
					v: '20180606',
				},
				responseType: 'json',
			});

			const items: HereNowItem[] = get(data, ['data', 'response', 'hereNow', 'items'], []);

			if (state.herenow.has(place.id)) {
				const newUsers = items.filter(({id}) => (
					state.herenow.get(place.id).find((user) => user.id === id) === undefined
				));

				for (const {user, shout} of newUsers) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: stripIndent`
							:bee: \`${[user.firstName, user.lastName].join(' ').trim()}\` が${place.name}にチェックインしました
							${shout ? `「${shout}」` : ''}
						`,
						username: 'checkin',
						icon_url: `${user.photo.prefix}110x110${user.photo.suffix}`,
					});
				}
			}

			state.herenow.set(place.id, items);
		}
	};

	if (process.env.NODE_ENV === 'production') {
		schedule.scheduleJob('*/3 * * * *', job);
	}

	eventClient.on('message', (message: MessageEvent) => {
		if ('text' in message && message.text === 'checkin-check' && message.channel === process.env.CHANNEL_SANDBOX) {
			job();
		}
	});
};
