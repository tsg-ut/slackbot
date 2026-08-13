import type {SlackInterface} from '../lib/slack.js';
import {extractMessage} from '../lib/slackUtils.js';
import {TwentyQuestions} from './TwentyQuestions.js';
import type {MessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';

export default async (slackInterface: SlackInterface) => {
	const mutex = new Mutex();

	const twentyQuestions = await TwentyQuestions.create(slackInterface);

	slackInterface.eventClient.on('message', async (event: MessageEvent) => {
		const message = extractMessage(event);
		if (
			message !== null &&
			message.channel === process.env.CHANNEL_SANDBOX &&
			message.text === '20の扉'
		) {
			mutex.runExclusive(() => twentyQuestions.startGame(message.user));
		}
	});
};
