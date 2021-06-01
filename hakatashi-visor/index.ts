import {ChatPostMessageArguments} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import axios from 'axios';
// @ts-ignore
import schedule from 'node-schedule';
import type {SlackInterface} from '../lib/slack';
import logger from '../lib/logger';

const mutex = new Mutex();

const CALLME = '@hakatashi-visor';

const checkSolidity = async () => {
	/* eslint-disable max-len */
	const res = await axios.get('https://github.com/hakatashi/hakatashi/workflows/Being%20a%20solid%20person/badge.svg');

	if (res.data.includes('failing')) {
		return false;
	}
	return true;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message) => {
		// @ts-ignore
		if (message.text && message.subtype === undefined &&
      message.text.startsWith(CALLME) && (message.channel === process.env.CHANNEL_SANDBOX || message.channel.startsWith('D'))) { // message is toward me
			const args = message.text.split(' ').slice(1);
			if (args.length !== 0) {
				await postHelp(message);
				return;
			}
			await checkSolidityPost();
		}
	});

	const checkSolidityPost = async () => {
		if (await checkSolidity()) {
			logger.warn('HAKATASHI IS SOLID TODAY!!!!!!!!!!!!!!');
			await slack.chat.postMessage({
				username: CALLME,
				icon_emoji: ':heavy-exclamation-mark:',
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
          今日はhakatashiがsolid personだよ！！！ :among_us_report: :among_us_report: :among_us_report:
          1/32768の確率だよ :waiwai: :hakatashi: :azaika-crying:
        `,
			});
		} else {
			await slack.chat.postMessage({
				username: CALLME,
				icon_emoji: ':sorehasou:',
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
          今日もhakatashiはsolidじゃないよ...
        `,
			});
		}
	};

	const postHelp = async (receivedMessage: any) => {
		postMessageDefault(receivedMessage, {
			text: stripIndent`
        hakatashiがsolidかどうかを監視するよ!
        solidなpersonになる確率は1/32768だよ :eyes: :eyes:
      `,
		});
	};

	const postMessageDefault = async (receivedMessage: any, config = {}) => {
		const postingConfig: ChatPostMessageArguments = {
			username: CALLME,
			icon_emoji: ':sorehasou:',
			channel: receivedMessage.channel,
			text: '',
			...config,
		};
		await slack.chat.postMessage(postingConfig);
	};

	schedule.scheduleJob('0 9 * * *', () => {
		mutex.runExclusive(() => {
			checkSolidityPost();
		});
	});
};
