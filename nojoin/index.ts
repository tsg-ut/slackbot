import type {FastifyPluginAsync} from 'fastify';
import plugin from 'fastify-plugin';
import State from '../lib/state';
import type {SlackInterface, SlashCommandEndpoint} from '../lib/slack';

interface StateObj {
	optoutUsers: string[],
}

export const server = async ({eventClient, webClient: slack}: SlackInterface) => {
	const state = await State.init<StateObj>('nojoin', {
		optoutUsers: [],
	});

	eventClient.on('message', async (message: any) => {
		if (
			(message.subtype === 'channel_join' && message.channel === process.env.CHANNEL_SANDBOX) ||
			message.subtype === 'channel_leave'
		) {
			if (state.optoutUsers.includes(message.user)) {
				return;
			}

			await slack.chat.delete({
				token: process.env.HAKATASHI_TOKEN,
				channel: message.channel,
				ts: message.ts,
			});
		}
	});

	const callback: FastifyPluginAsync = async (fastify, _opts) => {
		fastify.post<SlashCommandEndpoint>('/slash/nojoin', async (req, res) => {
			if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				res.code(400);
				return 'Bad Request';
			}

			const command = req.body.text.trim();

			if (command === 'optin') {
				if (state.optoutUsers.includes(req.body.user_id)) {
					state.optoutUsers.splice(state.optoutUsers.indexOf(req.body.user_id), 1);
					return 'オプトインしたよ😘';
				}
				return 'もうすでにオプトインしてるよ🥰';
			}

			if (command === 'optout') {
				if (!state.optoutUsers.includes(req.body.user_id)) {
					state.optoutUsers.push(req.body.user_id);
					return 'オプトアウトしたよ😘';
				}
				return 'もうすでにオプトアウトしてるよ🥰';
			}

			return 'Usage: /nojoin [optin|optout]';
		});
	};

	return plugin(callback);
};
