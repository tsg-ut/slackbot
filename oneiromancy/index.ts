import {readFile} from 'fs/promises';
import path from 'path';
import {Mutex} from 'async-mutex';
import yaml from 'js-yaml';
import OpenAI from 'openai';
import {increment} from '../achievements';
import logger from '../lib/logger';
import openai from '../lib/openai';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';

const mutex = new Mutex();
const log = logger.child({bot: 'oneiromancy'});

const promptLoader = new Loader<OpenAI.Chat.ChatCompletionMessageParam[]>(async () => {
	const promptYaml = await readFile(path.join(__dirname, 'prompt.yml'));
	const prompt = yaml.load(promptYaml.toString()) as OpenAI.Chat.ChatCompletionMessageParam[];
	return prompt;
});

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

		log.info(`reaction_added: ${event.item.channel} ${event.item.ts}`);

		mutex.runExclusive(async () => {
			if (state.postedMessages[event.item.ts] !== undefined) {
				const oneiromancyMessage = state.postedMessages[event.item.ts];
				const url = `https://tsg-ut.slack.com/archives/${process.env.CHANNEL_SANDBOX}/p${oneiromancyMessage.replace('.', '')}`;
				await slack.chat.postEphemeral({
					channel: event.item.channel,
					text: `その夢は既に占っています ${url}`,
					user: event.user,
					username: '夢占いBOT',
					icon_emoji: 'crystal_ball',
				});
				return;
			}

			log.info('Requesting to Slack API...');
			const res = await slack.conversations.replies({
				channel: event.item.channel,
				ts: event.item.ts,
				token: process.env.HAKATASHI_TOKEN,
			});

			const message = res?.messages?.[0];
			if (message === undefined || typeof message?.text !== 'string') {
				return;
			}

			if (message.ts !== event.item.ts) {
				await slack.chat.postEphemeral({
					channel: event.item.channel,
					text: 'スレッド内のメッセージの占いには対応していません',
					user: event.user,
					username: '夢占いBOT',
					icon_emoji: 'crystal_ball',
				});
				return;
			}

			let messageUrl = `https://tsg-ut.slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}`;
			if (message.thread_ts !== undefined) {
				messageUrl += `?thread_ts=${message.thread_ts}`;
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
			const completion = await openai.chat.completions.create({
				model: 'gpt-3.5-turbo',
				messages: [
					...prompt,
					{
						role: 'user',
						content: `ありがとうございます。以下の夢についても同じように、夢の内容を診断して、今日の運勢を100点満点で占ってください。また、今後の生活にどのように活かすべきかのアドバイスを含んだ夢占いをしてください。\n【${inputMessage}】`,
					},
				],
				max_tokens: 1024,
			});

			const result = completion.choices?.[0]?.message?.content ?? 'すみません。この夢に関しては占えませんでした。';

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

			if (event.item.channel === process.env.CHANNEL_SIG_DREAM) {
				await increment(event.item_user, 'oneiromancy-analyzed');
				await increment(event.user, 'oneiromancy-analyze');

				const scoreText = result.match(/【\s*今日の運勢\s*】\s*(?<score>[-\d]+)\s*点/)?.groups?.score;
				const score = scoreText === undefined ? null : parseInt(scoreText);

				log.info(`score: ${score}`);

				if (score === null) {
					await increment(event.item_user, 'oneiromancy-no-score');
				} else {
					await increment(event.item_user, 'oneiromancy-scored');
					await increment(event.item_user, 'oneiromancy-scores', score);

					if (score > 100) {
						await increment(event.item_user, 'oneiromancy-score-over-100');
					}
					if (score === 100) {
						await increment(event.item_user, 'oneiromancy-score-100');
					}
					if (score >= 80) {
						await increment(event.item_user, 'oneiromancy-score-above-80');
					}
					if (score <= 50) {
						await increment(event.item_user, 'oneiromancy-score-below-50');
					}
					if (score <= 20) {
						await increment(event.item_user, 'oneiromancy-score-below-20');
					}
					if (score === 0) {
						await increment(event.item_user, 'oneiromancy-score-0');
					}
					if (score < 0) {
						await increment(event.item_user, 'oneiromancy-score-under-0');
					}
				}
			}
		});
	});
};
