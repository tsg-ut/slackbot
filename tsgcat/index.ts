// @ts-ignore
import {stripIndent} from 'common-tags';
import * as zlib from 'zlib';
import axios from 'axios';
import qs from 'querystring';
// @ts-ignore
import getReading from '../lib/getReading.js';
// @ts-ignore
import {hiraganize} from 'japanese';
import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export default ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message) => {
		if (!message.text) {
			return;
		}

		const {text} = message;
		let matches: String[] = null;

		if ((matches = text.match(/^@tsg[a-z\d]+$/))) {
			const word = text.slice(4);

			const {data} = await axios.get(`https://script.google.com/macros/s/AKfycbwOOAwwO1fjUuyhUpLhB3uTHq5iNmNRYF6UjGhWnXzRWLWCpo-K/exec?${qs.stringify({
				text: word,
				source: 'en',
				target: 'ja',
			})}`);
			const reading = hiraganize(await getReading(data.toString()))

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `${reading}～`,
				username: `tsg${word}`,
				icon_emoji: ':cat2:',
			});
		}
	});
};
