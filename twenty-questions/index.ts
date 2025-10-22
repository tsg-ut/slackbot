import type {SlackInterface} from '../lib/slack';
import {extractMessage} from '../lib/slackUtils';
import {TwentyQuestions} from './TwentyQuestions';
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
