import {Mutex} from 'async-mutex';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
import type {SlashCommandEndpoint, SlackInterface} from '../lib/slack';
import {GoogleCalendar} from './GoogleCalendar';

const mutex = new Mutex();

export const server = (slack: SlackInterface) => {
	const callback: FastifyPluginCallback = async (fastify, _opts, next) => {
		const bot = await GoogleCalendar.create(slack);
		bot.initialize();

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

		next();
	};

	return plugin(callback);
};
