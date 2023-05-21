import {readFile} from 'fs/promises';
import path from 'path';
import {Mutex} from 'async-mutex';
import yaml from 'js-yaml';
import {ChatCompletionRequestMessage, Configuration, OpenAIApi} from 'openai';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';

const mutex = new Mutex();

const promptLoader = new Loader<ChatCompletionRequestMessage[]>(async () => {
	const promptYaml = await readFile(path.join(__dirname, 'prompt.yaml'));
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
	const {eventClient, webClient: slack} = slackClients;

	const state = await State.init<StateObj>('oneiromancy', {
		threadId: null,
		postedMessages: Object.create(null),
	});

	eventClient.on('reaction_added', (event) => {
		if (
			event.reaction !== 'crystal_ball' ||
			state.postedMessages[event.item.ts] !== undefined
		) {
			return;
		}

		const messageUrl = `https://tsg-utslack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}`;

		mutex.runExclusive(async () => {
			const res = await slack.conversations.history({
				channel: event.item.channel,
				latest: event.item.ts,
				limit: 1,
				inclusive: true,
			});

			const message = res?.messages?.[0];
			if (message === undefined) {
				return;
			}

			const text = message.text ?? '';

			const prompt = await promptLoader.load();
			const completion = await openai.createChatCompletion({
				model: 'gpt-3.5-turbo',
				messages: [
					...prompt,
					{
						role: 'user',
						content: `ありがとうございます。以下の夢についても占ってください。\n【${text}】`,
					},
				],
				max_tokens: 512,
			});

			const result = completion.data.choices?.[0]?.message?.content ?? 'すみません。この夢に関しては占えませんでした。';

			let {threadId} = state;
			if (threadId === null) {
				const anchorMessage = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '夢占いスレッド🔮\n占ってほしい夢がある時は、🔮リアクションをメッセージに付けてください',
				});
				threadId = anchorMessage.ts;
				state.threadId = anchorMessage.ts;
			}

			const postedMessage = await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `${result}\n\n${messageUrl}`,
				thread_ts: threadId,
				reply_broadcast: true,
				unfurl_links: true,
				unfurl_media: true,
			});

			state.postedMessages[event.item.ts] = postedMessage.ts;
		});
	});
};
