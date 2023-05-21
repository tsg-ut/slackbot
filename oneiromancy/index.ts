import {readFile} from 'fs/promises';
import path from 'path';
import {Mutex} from 'async-mutex';
import yaml from 'js-yaml';
import {ChatCompletionRequestMessage, Configuration, OpenAIApi} from 'openai';
import logger from '../lib/logger';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';

const mutex = new Mutex();
const log = logger.child('oneiromancy');

const promptLoader = new Loader<ChatCompletionRequestMessage[]>(async () => {
	const promptYaml = await readFile(path.join(__dirname, 'prompt.yml'));
	const prompt = yaml.load(promptYaml.toString()) as ChatCompletionRequestMessage[];
	return prompt;
});

const configuration = new Configuration({
	apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

interface StateObj {
	threadId: string | null,
	postedMessages: {
		[ts: string]: string,
	},
}

export default async (slackClients: SlackInterface) => {
	log.info('oneiromancy plugin loaded');
	const {eventClient, webClient: slack} = slackClients;

	const state = await State.init<StateObj>('oneiromancy', {
		threadId: null,
		postedMessages: Object.create(null),
	});

	eventClient.on('reaction_added', (event) => {
		if (event.reaction !== 'crystal_ball') {
			return;
		}

		if (state.postedMessages[event.item.ts] !== undefined) {
			const oneiromancyMessage = state.postedMessages[event.item.ts];
			const url = `https://tsg-ut.slack.com/archives/${process.env.CHANNEL_SANDBOX}/p${oneiromancyMessage.replace('.', '')}`;
			slack.chat.postEphemeral({
				channel: event.item.channel,
				text: `その夢は既に占っています ${url}`,
				user: event.user,
				username: '夢占いBOT',
				icon_emoji: 'crystal_ball',
			});
			return;
		}

		log.info(`reaction_added: ${event.item.channel} ${event.item.ts}`);
		const messageUrl = `https://tsg-ut.slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}`;

		mutex.runExclusive(async () => {
			log.info(`reaction_added: ${messageUrl}`);
			const res = await slack.conversations.history({
				channel: event.item.channel,
				latest: event.item.ts,
				limit: 1,
				inclusive: true,
			});

			const message = res?.messages?.[0];
			if (message === undefined || typeof message?.text !== 'string') {
				return;
			}

			const inputMessage = message.text.replaceAll(/[【】]/g, '');
			const prompt = await promptLoader.load();

			await slack.chat.postEphemeral({
				channel: event.item.channel,
				text: '占っています...',
				user: event.user,
				username: '夢占いBOT',
				icon_emoji: 'crystal_ball',
			});

			log.info('Requesting to OpenAI API...');
			const completion = await openai.createChatCompletion({
				model: 'gpt-3.5-turbo',
				messages: [
					...prompt,
					{
						role: 'user',
						content: `ありがとうございます。以下の夢についても占ってください。\n【${inputMessage}】`,
					},
				],
				max_tokens: 512,
			});

			const result = completion.data.choices?.[0]?.message?.content ?? 'すみません。この夢に関しては占えませんでした。';

			let {threadId} = state;
			if (threadId === null) {
				log.info('threadId is null');
				const anchorMessage = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '夢占いスレッド🔮\n占ってほしい夢がある時は、🔮リアクションをメッセージに付けてください',
				});
				threadId = anchorMessage.ts;
				state.threadId = anchorMessage.ts;
			}

			log.info(`threadId: ${threadId}`);
			const postedMessage = await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: '夢占いBOT',
				icon_emoji: 'crystal_ball',
				text: `${messageUrl}\n\n${result}`,
				thread_ts: threadId,
				reply_broadcast: true,
				unfurl_links: true,
				unfurl_media: true,
			});

			state.postedMessages[event.item.ts] = postedMessage.ts;
		});
	});
};
