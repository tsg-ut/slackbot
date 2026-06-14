import 'dotenv/config';

import type {Block, ChatPostMessageArguments, GenericMessageEvent, KnownBlock} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {sample} from 'lodash';
import {increment} from '../achievements';
import {typicalMessageTextsGenerator} from '../atequiz';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {Deferred} from '../lib/utils';
import {prefectures, type PrefectureKanji} from '../room-gacha/prefectures';
import {getCorrectAnswers} from './answers';
import {generateAiHints} from './hints';
import {PrefectureAteQuiz} from './PrefectureAteQuiz';
import type {PrefectureSources} from './sources';
import {collectSources} from './sources';

const log = logger.child({bot: 'prefecture-quiz'});
const mutex = new Mutex();

function buildInitialProblemBlocks(hint1: string): (Block | KnownBlock)[] {
	return [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: ':japan: 都道府県当てクイズ！',
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'スレッドで回答してください。1人3回まで有効です。',
			},
		},
		{
			type: 'rich_text',
			elements: [
				{
					type: 'rich_text_section',
					elements: [{type: 'text', text: '現在公開中のヒント:'}],
				},
				{
					type: 'rich_text_list',
					style: 'ordered',
					indent: 0,
					border: 0,
					elements: [
						{
							type: 'rich_text_section',
							elements: [{type: 'text', text: hint1}],
						},
					],
				},
			],
		},
	];
}

function buildAnswerBlocks(prefName: string, allHints: string[], sources: PrefectureSources): (Block | KnownBlock)[] {
	const sourceLinks: string[] = [];
	if (sources.webSource) {
		sourceLinks.push(`<${sources.webSource.url}|${sources.webSource.name}>`);
	}
	if (sources.tourismArticle) {
		const wikiUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(sources.tourismArticle.title)}`;
		sourceLinks.push(`<${wikiUrl}|${sources.tourismArticle.title} (Wikipedia)>`);
	}
	if (sources.foodArticle) {
		const wikiUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(sources.foodArticle.title)}`;
		sourceLinks.push(`<${wikiUrl}|${sources.foodArticle.title} (Wikipedia)>`);
	}

	const prefWikiUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(prefName)}`;
	sourceLinks.unshift(`<${prefWikiUrl}|${prefName} (Wikipedia)>`);

	return [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: `答え: ${prefName}`,
			},
		},
		{
			type: 'rich_text',
			elements: [
				{
					type: 'rich_text_section',
					elements: [{type: 'text', text: 'AIヒント一覧:'}],
				},
				{
					type: 'rich_text_list',
					style: 'ordered',
					indent: 0,
					border: 0,
					elements: allHints.map((hint) => ({
						type: 'rich_text_section',
						elements: [{type: 'text', text: hint}],
					})),
				},
			],
		},
		{
			type: 'context',
			elements: [
				{
					type: 'mrkdwn',
					text: `ソース: ${sourceLinks.join(', ')}`,
				},
			],
		},
	];
}

class PrefectureQuizBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^都道府県当てクイズ$/;
	protected override readonly username = '都道府県当てクイズ';
	protected override readonly iconEmoji = ':japan:';
	protected override readonly allowedChannels = [process.env.CHANNEL_SANDBOX!];

	protected override onWakeWord(_message: GenericMessageEvent, channel: string): Promise<string | null> {
		const quizMessageDeferred = new Deferred<string | null>();

		mutex.runExclusive(async () => {
			try {
				const prefName = sample(Object.keys(prefectures)) as PrefectureKanji;
				const prefRomaji = prefectures[prefName];

				log.info(`Starting prefecture quiz for ${prefName}`);

				await this.postMessage({
					channel,
					text: `${prefName}の都道府県当てクイズを準備中です...`,
				});

				const sources = await collectSources(prefName, prefRomaji);
				const hints = await generateAiHints(prefName, sources);

				if (!hints || hints.length < 5) {
					await this.postMessage({
						channel,
						text: 'AIヒントの生成に失敗しました。もう一度お試しください。',
					});
					quizMessageDeferred.resolve(null);
					return;
				}

				const correctAnswers = getCorrectAnswers(prefName);
				const hint1 = hints[0];
				const hintMessages2to5 = hints.slice(1).map((hint, i) => ({
					channel,
					text: `ヒント${i + 2}: ${hint}`,
				}));

				const problem = {
					problemMessage: {
						channel,
						text: `都道府県当てクイズ: ヒント1: ${hint1}`,
						blocks: buildInitialProblemBlocks(hint1),
					} as ChatPostMessageArguments,
					hintMessages: hintMessages2to5,
					immediateMessage: {
						channel,
						text: 'スレッド内で回答してください。1人3回まで有効です。ヒントは45秒ごとに追加されます。',
					} as ChatPostMessageArguments,
					solvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.solved(prefName),
					} as ChatPostMessageArguments,
					unsolvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.unsolved(prefName),
					} as ChatPostMessageArguments,
					get answerMessage() {
						return {
							channel,
							text: `答え: ${prefName}`,
							blocks: buildAnswerBlocks(prefName, hints, sources),
						} as ChatPostMessageArguments;
					},
					correctAnswers,
				};

				const quiz = new PrefectureAteQuiz(this.slackClients, problem, hints, {
					username: '都道府県当てクイズ',
					icon_emoji: ':japan:',
				});

				const result = await quiz.start({
					mode: 'normal',
					onStarted(startMessage) {
						quizMessageDeferred.resolve(startMessage.ts ?? null);
					},
				});

				await this.deleteProgressMessage(await quizMessageDeferred.promise);

				if (result.state === 'solved' && result.correctAnswerer) {
					await increment(result.correctAnswerer, 'prefecture-quiz-answer');

					// hintIndex=0 means no hintMessages (hints 2–5) were posted before correct answer
					if (result.hintIndex === 0) {
						await increment(result.correctAnswerer, 'prefecture-quiz-answer-first-hint');
					}
				}
			} catch (error) {
				log.error(`Error in prefecture quiz: ${error.stack ?? error.message}`);
				await this.postMessage({
					channel,
					text: `エラーが発生しました: ${error.message}`,
				});
				quizMessageDeferred.resolve(null);
			}
		});

		return quizMessageDeferred.promise;
	}
}

export default (slackClients: SlackInterface) => new PrefectureQuizBot(slackClients);
