import type {MessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import type {FastifyPluginAsync} from 'fastify';
import plugin from 'fastify-plugin';
import logger from '../lib/logger.js';
import type {SlashCommandEndpoint, SlackInterface} from '../lib/slack.js';
import {extractMessage} from '../lib/slackUtils.js';
import {Deferred} from '../lib/utils.js';
import {GoogleCalendar} from './GoogleCalendar.js';

const log = logger.child({bot: 'google-calendar'});
const mutex = new Mutex();

const botDeferred = new Deferred<GoogleCalendar>();

export default async (slack: SlackInterface) => {
	const bot = await GoogleCalendar.create(slack);
	bot.initialize();

	botDeferred.resolve(bot);

	slack.eventClient.on('message', async (event: MessageEvent) => {
		const message = extractMessage(event);
		if (!message?.text?.includes('@google-calendar sync')) {
			return;
		}

		await slack.webClient.reactions.add({
			channel: message.channel,
			timestamp: message.ts,
			name: 'ok',
		});

		try {
			await bot.syncDiscordNow();
		} catch (error: unknown) {
			log.error('Manual Discord sync failed', {error});
		}

		await slack.webClient.reactions.add({
			channel: message.channel,
			timestamp: message.ts,
			name: '+1',
		});
	});
};

export const server = () => {
	const callback: FastifyPluginAsync = async (fastify, _opts) => {
		const bot = await botDeferred.promise;

		fastify.post<SlashCommandEndpoint>('/slash/calendar', (req, res) => {
			if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				res.code(400);
				return 'Bad Request';
			}

			mutex.runExclusive(async () => {
				await bot.showSettingsModal(req.body.channel_id, req.body.trigger_id);
			});

			return '';
		});

	};

	return plugin(callback);
};
