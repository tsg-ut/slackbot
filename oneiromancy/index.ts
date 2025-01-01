import {readFile} from 'fs/promises';
import path from 'path';
import {ReactionAddedEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import yaml from 'js-yaml';
// eslint-disable-next-line import/no-named-as-default
import OpenAI from 'openai';
import {increment} from '../achievements';
import dayjs from '../lib/dayjs';
import logger from '../lib/logger';
import openai from '../lib/openai';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';

const mutex = new Mutex();
const log = logger.child({bot: 'oneiromancy'});

const normalPromptIntro = 'ありがとうございます。以下の夢についても同じように、夢の内容を診断して、今日の運勢を100点満点で占ってください。また、今後の生活にどのように活かすべきかのアドバイスを含んだ夢占いをしてください。';
const newyearPromptIntro = 'ありがとうございます。以下の夢についても同じように、私が1月1日の元日から1週間のうちに見た夢を書き表したものです。日本の「初夢」の習慣にならって、夢の内容をもとに縁起の良さを判定し、今年の運勢を「大吉」「中吉」「小吉」「吉」「半吉」「末吉」「凶」「小凶」「半凶」「末凶」「大凶」のいずれかで占ってください。また、今年1年の間にどのようなことが起きるかの予測を含んだ夢占いをしてください。';

interface OneiromancyPrompts {
	normal: OpenAI.Chat.ChatCompletionMessageParam[],
	newyear: OpenAI.Chat.ChatCompletionMessageParam[],
}

const promptLoader = new Loader<OneiromancyPrompts>(async () => {
	const prompts = await Promise.all(['prompt.yml', 'newyear-prompt.yml'].map(async (filename) => {
		const promptYaml = await readFile(path.join(__dirname, filename));
		const prompt = yaml.load(promptYaml.toString()) as OpenAI.Chat.ChatCompletionMessageParam[];
		return prompt;
	}));
	return {
		normal: prompts[0],
		newyear: prompts[1],
	};
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

	eventClient.on('reaction_added', (event: ReactionAddedEvent) => {
		if (event.reaction !== 'crystal_ball') {
			return;
		}

		const now = dayjs(parseFloat(event.item.ts) * 1000).tz('Asia/Tokyo');

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
			const prompts = await promptLoader.load();

			const isNewYear = now.month() === 0 && now.date() <= 7;
			const promptIntro = isNewYear ? newyearPromptIntro : normalPromptIntro;
			const prompt = isNewYear ? prompts.newyear : prompts.normal;

			await slack.chat.postEphemeral({
				channel: event.item.channel,
				text: '占っています...',
				user: event.user,
				username: '夢占いBOT',
				icon_emoji: 'crystal_ball',
			});

			log.info('Requesting to OpenAI API...');
			const completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					...prompt,
					{
						role: 'user',
						content: `${promptIntro}\n【${inputMessage}】`,
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

			const resultIntro = isNewYear ? '🎌🎍初夢占い🎍🎌\n\n' : '';

			log.info(`threadId: ${threadId}`);
			const postedMessage = await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: '夢占いBOT',
				icon_emoji: 'crystal_ball',
				text: `${messageUrl}\n\n${resultIntro}${result}`,
				thread_ts: threadId,
				reply_broadcast: true,
				unfurl_links: true,
				unfurl_media: true,
			});

			state.postedMessages[event.item.ts] = postedMessage.ts;

			if (event.item.channel === process.env.CHANNEL_SIG_DREAM) {
				await increment(event.item_user, 'oneiromancy-analyzed');
				await increment(event.user, 'oneiromancy-analyze');
				if (isNewYear) {
					await increment(event.item_user, 'oneiromancy-newyear-analyzed');
				}

				const scoreText = result.match(/今日の運勢は【\s*(?<score>[-\d]+)\s*点\s*】/)?.groups?.score;
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
