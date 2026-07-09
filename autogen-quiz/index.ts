/* eslint-disable init-declarations */
/* eslint-disable array-plural/array-plural */
import 'dotenv/config';

import assert, {AssertionError} from 'assert';
import path from 'path';
import qs from 'querystring';
import {inspect} from 'util';
import type {ChatPostMessageArguments, GenericMessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import {stripIndent} from 'common-tags';
import eaw from 'eastasianwidth';
import fsExtra from 'fs-extra';
const {readFile} = fsExtra;
import yaml from 'js-yaml';
import {sample, sortBy} from 'lodash-es';
// @ts-ignore: untyped
import emoji from 'node-emoji';
import type OpenAI from 'openai';
import {z} from 'zod';
import {increment} from '../achievements/index.js';
import {AteQuiz, typicalMessageTextsGenerator} from '../atequiz/index.js';
import type {AteQuizProblem} from '../atequiz/index.js';
import {judgeAnswer} from '../discord/hayaoshiUtils.js';
import {ChannelLimitedBot} from '../lib/channelLimitedBot.js';
import logger from '../lib/logger.js';
import openai from '../lib/openai.js';
import {SlackInterface} from '../lib/slack.js';
import {getMemberName} from '../lib/slackUtils.js';
import {Loader, Deferred} from '../lib/utils.js';
import genres from './genres.js';

import {fileURLToPath} from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mutex = new Mutex();

const log = logger.child({bot: 'autogen-quiz'});

interface AutogenQuizPrompts {
	wikipedia: {
		enumerate_topics: string,
		enumerate_topics_with_big_genre: string,
		select_wikipedia: string,
		enumerate_answers_with_wikipedia: string,
		enumerate_answers_without_wikipedia: string,
		generate_quiz: string,
		generate_alternative_answers: string,
		generate_quiz_json: string,
	},
}

const GeneratedQuiz = z.object({
	question: z.string().nonempty(),
	mainAnswer: z.string().nonempty(),
	alternativeAnswers: z.array(z.string().nonempty()),
});

// eslint-disable-next-line no-redeclare
type GeneratedQuiz = z.infer<typeof GeneratedQuiz>;

const WikipediaPagesResponse = z.object({
	query: z.object({
		pages: z.record(z.object({
			extract: z.string(),
		})),
	}),
});

// eslint-disable-next-line no-redeclare
type WikipediaPagesResponse = z.infer<typeof WikipediaPagesResponse>;

const promptsLoader = new Loader<AutogenQuizPrompts>(async () => {
	const prompts = await Promise.all(['wikipedia'].map(async (filename) => {
		const promptYaml = await readFile(path.join(__dirname, 'prompts', `${filename}.yaml`));
		const prompt = yaml.load(promptYaml.toString());
		return [filename, prompt];
	}));
	return Object.fromEntries(prompts);
});

const getPlaintextWikipedia = async (title: string): Promise<string> => {
	log.info(`Getting wikipedia ${title}...`);

	const url = `https://ja.wikipedia.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'extracts',
		explaintext: true,
		titles: title,
	})}`;

	const response = await fetch(url);
	const json = WikipediaPagesResponse.parse(await response.json());

	const pages = json?.query?.pages;
	const content = pages?.[Object.keys(pages)[0]]?.extract;
	if (!content) {
		throw new Error(`Failed to get wikipedia source of "${title}"`);
	}

	return content;
};

const extractBulletTitles = (content: string): string[] => {
	const bulletRegex = /^(?:\*|\+|-|\d+\.)\s*(.+)$/gm;
	const titles: string[] = [];

	let match: RegExpExecArray | null;
	while ((match = bulletRegex.exec(content)) !== null) {
		titles.push(match[1]);
	}

	return titles;
};

const formatTemplate = (content: string, params: Record<string, string> = {}): string => {
	let result = content;
	for (const [key, value] of Object.entries(params)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	let match: RegExpMatchArray | null = null;
	if ((match = result.match(/\{\{.*?\}\}/g)) !== null) {
		throw new AssertionError({
			message: `Unresolved template variables: ${match.join(', ')}`,
		});
	}
	return result.trim();
};

interface BraveSearchResult {
	title: string,
	url: string,
}

const getBraveSearchResult = async (query: string): Promise<BraveSearchResult[]> => {
	const {data} = await axios.get('https://api.search.brave.com/res/v1/web/search', {
		params: {
			q: query,
		},
		headers: {
			Accept: 'application/json',
			'X-Subscription-Token': process.env.BRAVE_SEARCH_API_TOKEN,
		},
	});

	const searchResults = data?.web?.results ?? [];

	log.info(`Got ${searchResults.length} results for ${query}`);

	return searchResults;
};

interface QuizGenerationInformation {
	generatedQuiz: GeneratedQuiz,
	genre: string,
	topic: string,
	wikipediaTitle: string,
}

const generateQuizWikipediaMethod = async (genre: string, bigGenre: string | null = null): Promise<QuizGenerationInformation | null> => {
	const prompts = await promptsLoader.load();
	const chatHistory: OpenAI.ChatCompletionMessageParam[] = [];

	chatHistory.push({
		role: 'user',
		content: bigGenre === null
			? formatTemplate(prompts.wikipedia.enumerate_topics, {genre})
			: formatTemplate(prompts.wikipedia.enumerate_topics_with_big_genre, {
				genre,
				big_genre: bigGenre,
			}),
	});

	const response1 = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: chatHistory,
		max_tokens: 1024,
	});

	const resultMessage1 = response1?.choices?.[0]?.message;
	log.info(`Response: ${inspect(resultMessage1)}`);

	if (!resultMessage1?.content) {
		log.info('No content found in the response');
		return null;
	}

	chatHistory.push(resultMessage1);

	const topics = extractBulletTitles(resultMessage1.content);
	log.info(`Extracted topics: ${inspect(topics)}`);

	if (topics.length === 0) {
		log.info('No topics found in the content');
		return null;
	}

	const selectedTopic = sample(topics);
	log.info(`Selected topic: ${inspect(selectedTopic)}`);

	const braveSearchResults = await getBraveSearchResult([
		genre,
		selectedTopic,
		'site:ja.wikipedia.org',
	].join(' '));

	const wikipediaCandidates = braveSearchResults.slice(0, 5).map((result) => (
		result.title.split(' - ')[0]
	));
	const wikipediaCandidatesText = wikipediaCandidates.map((title) => `* ${title}`).join('\n');

	chatHistory.push({
		role: 'user',
		content: formatTemplate(prompts.wikipedia.select_wikipedia, {
			genre,
			topic: selectedTopic,
			wikipedia_candidates: wikipediaCandidatesText,
		}),
	});

	const response2 = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: chatHistory,
		max_tokens: 1024,
	});

	const resultMessage2 = response2?.choices?.[0]?.message;
	log.info(`Response: ${inspect(resultMessage2)}`);

	if (!resultMessage2?.content) {
		log.info('No content found in the response');
		return null;
	}

	chatHistory.push(resultMessage2);

	let selectedWikipedia;
	if (!resultMessage2.content.includes('いいえ、ありません')) {
		const sortedWikipediaCandidates = sortBy(wikipediaCandidates, (candidate) => candidate.length).reverse();
		selectedWikipedia = sortedWikipediaCandidates.find((candidate) => (
			resultMessage2.content.toLowerCase().includes(candidate.toLowerCase())
		));
	}
	log.info(`Selected Wikipedia: ${inspect(selectedWikipedia)}`);

	if (selectedWikipedia) {
		try {
			const wikipediaContent = await getPlaintextWikipedia(selectedWikipedia);
			chatHistory.push({
				role: 'user',
				content: formatTemplate(prompts.wikipedia.enumerate_answers_with_wikipedia, {
					genre,
					topic: selectedTopic,
					wikipedia_title: selectedWikipedia,
					wikipedia_content: wikipediaContent,
				}),
			});
		} catch (error) {
			log.error(`Failed to get Wikipedia content: ${error.message}`);
			chatHistory.push({
				role: 'user',
				content: formatTemplate(prompts.wikipedia.enumerate_answers_without_wikipedia, {
					genre,
					topic: selectedTopic,
				}),
			});
		}
	} else {
		chatHistory.push({
			role: 'user',
			content: formatTemplate(prompts.wikipedia.enumerate_answers_without_wikipedia, {
				genre,
				topic: selectedTopic,
			}),
		});
	}

	const response3 = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: chatHistory,
		max_tokens: 1024,
	});

	const resultMessage3 = response3?.choices?.[0]?.message;
	log.info(`Response: ${inspect(resultMessage3)}`);

	if (!resultMessage3?.content) {
		log.info('No content found in the response');
		return null;
	}
	chatHistory.push(resultMessage3);

	const answerCandidates = extractBulletTitles(resultMessage3.content).filter((title) => (
		!genre.includes(title)
	));
	if (answerCandidates.length === 0) {
		log.info('No answer candidates found in the content');
		return null;
	}

	const selectedAnswer = sample(answerCandidates);
	log.info(`Selected answer: ${inspect(selectedAnswer)}`);

	chatHistory.push({
		role: 'user',
		content: formatTemplate(prompts.wikipedia.generate_quiz, {
			genre,
			topic: selectedTopic,
			answer: selectedAnswer,
		}),
	});

	const response4 = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: chatHistory,
		max_tokens: 1024,
	});

	const resultMessage4 = response4?.choices?.[0]?.message;
	log.info(`Response: ${inspect(resultMessage4)}`);

	if (!resultMessage4?.content) {
		log.info('No content found in the response');
		return null;
	}
	chatHistory.push(resultMessage4);

	chatHistory.push({
		role: 'user',
		content: formatTemplate(prompts.wikipedia.generate_alternative_answers),
	});

	const response5 = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: chatHistory,
		max_tokens: 1024,
	});

	const resultMessage5 = response5?.choices?.[0]?.message;
	log.info(`Response: ${inspect(resultMessage5)}`);

	if (!resultMessage5?.content) {
		log.info('No content found in the response');
		return null;
	}
	chatHistory.push(resultMessage5);

	chatHistory.push({
		role: 'user',
		content: formatTemplate(prompts.wikipedia.generate_quiz_json),
	});

	const response6 = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: chatHistory,
		max_tokens: 1024,
	});

	const resultMessage6 = response6?.choices?.[0]?.message;
	log.info(`Response: ${inspect(resultMessage6)}`);

	if (!resultMessage6?.content) {
		log.info('No content found in the response');
		return null;
	}

	const matchingJson = resultMessage6.content.match(/\{[\s\S]+?\}/)?.[0];
	if (!matchingJson) {
		log.info('No JSON found in the response');
		return null;
	}

	try {
		const parsedQuiz = JSON.parse(matchingJson);
		log.info(`Parsed quiz JSON: ${inspect(parsedQuiz)}`);

		const quiz = GeneratedQuiz.parse(parsedQuiz);

		return {
			generatedQuiz: quiz,
			genre,
			topic: selectedTopic,
			wikipediaTitle: selectedWikipedia,
		};
	} catch (error) {
		log.error(`Failed to parse quiz JSON: ${error.message}`);
		return null;
	}
};

const generateQuiz = (genre: string | null): Promise<QuizGenerationInformation | null> => {
	if (!genre) {
		const bigGenre = sample(Object.keys(genres));
		const smallGenre = sample(genres[bigGenre]);
		return generateQuizWikipediaMethod(smallGenre, bigGenre);
	}

	return generateQuizWikipediaMethod(genre);
};

const normalizeGenre = (genre: string): string => {
	const normalizedGenre = genre.normalize('NFKC').replace(/\s+/g, ' ').trim();
	return emoji.emojify(normalizedGenre);
};

const normalizeAnswer = (answer: string): string => (
	answer.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase()
);

class AutogenQuiz extends AteQuiz {
	constructor(
		options: {
			slack: SlackInterface,
			problem: AteQuizProblem,
			postOptions?: Partial<ChatPostMessageArguments>,
		},
	) {
		super(options.slack, options.problem, options.postOptions);
	}

	waitSecGen(_hintIndex: number): number {
		return 30;
	}

	async judge(answer: string) {
		const judgeResult = await judgeAnswer(this.problem.correctAnswers, answer);
		return judgeResult === 'correct';
	}
}

class AutogenQuizBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^(ランダムクイズ|(?<genre>.+?)のクイズ)$/u;

	protected override readonly username = 'ChatGPT';

	protected override readonly iconEmoji = ':chatgpt:';

	protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		const quizMessageDeferred = new Deferred<string | null>();

		mutex.runExclusive(async () => {
			try {
				const matches = this.wakeWordRegex.exec(message.text);
				const genre = matches?.groups?.genre ?? null;
				const normalizedGenre = genre ? normalizeGenre(genre) : null;

				if (normalizedGenre && eaw.length(normalizedGenre) > 24) {
					await this.slack.chat.postMessage({
						channel,
						text: 'トピックは全角12文字以内で指定してください❤',
						username: 'ChatGPT',
						icon_emoji: ':chatgpt:',
					});
					quizMessageDeferred.resolve(null);
					return;
				}

				await this.slack.chat.postEphemeral({
					channel,
					text: normalizedGenre ? `${normalizedGenre}に関するクイズを生成中です...` : 'クイズを生成中です...',
					username: 'ChatGPT',
					icon_emoji: ':chatgpt:',
					user: message.user,
				});

				const generation = await generateQuiz(normalizedGenre);

				if (!generation) {
					const {ts} = await this.slack.chat.postMessage({
						channel,
						text: 'クイズの生成に失敗しました😢',
						username: 'ChatGPT',
						icon_emoji: ':chatgpt:',
					});
					quizMessageDeferred.resolve(ts ?? null);
					return;
				}

				let concealedQuestion = generation.generatedQuiz.question;
				for (const correctAnswer of [generation.generatedQuiz.mainAnswer, ...generation.generatedQuiz.alternativeAnswers]) {
					concealedQuestion = concealedQuestion.replaceAll(correctAnswer, '◯◯');
				}

				const quizTextIntro = normalizedGenre === null ? 'クイズを自動生成したよ' : `＊${normalizedGenre}＊に関するクイズを自動生成したよ👍`;
				const quizText = stripIndent`
					${quizTextIntro}

					Q. ${concealedQuestion}
				`;
				const wikipediaLink = `https://ja.wikipedia.org/wiki/${encodeURIComponent(generation.wikipediaTitle)}`;

				const quiz = new AutogenQuiz({
					slack: this.slackClients,
					problem: {
						problemMessage: {
							channel,
							text: quizText,
						},
						immediateMessage: {
							channel,
							text: '30秒以内に答えてね！',
						},
						hintMessages: [],
						solvedMessage: {
							channel,
							text: typicalMessageTextsGenerator.solved(` ＊${generation.generatedQuiz.mainAnswer}＊ `),
						},
						unsolvedMessage: {
							channel,
							text: typicalMessageTextsGenerator.unsolved(` ＊${generation.generatedQuiz.mainAnswer}＊ `),
						},
						answerMessage: {
							channel,
							text: stripIndent`
								ジャンル: ${generation.genre}
								トピック: ${generation.topic}
								参考にしたWikipedia記事: <${wikipediaLink}|${generation.wikipediaTitle ?? 'なし'}>
								問題: ${generation.generatedQuiz.question}
								正答: ${generation.generatedQuiz.mainAnswer}
								別解: ${generation.generatedQuiz.alternativeAnswers.join(', ')}
							`,
						},
						correctAnswers: [
							generation.generatedQuiz.mainAnswer,
							...generation.generatedQuiz.alternativeAnswers,
						],
					},
					postOptions: {
						username: 'ChatGPT',
						icon_emoji: ':chatgpt:',
					},
				});

				const result = await quiz.start({
					mode: 'normal',
					onStarted: (startMessage) => {
						quizMessageDeferred.resolve(startMessage.ts ?? null);
					},
				});

				await this.deleteProgressMessage(await quizMessageDeferred.promise);
				log.info(`Quiz result: ${inspect(result)}`);

				if (result.state === 'solved') {
					const normalizedAnswer = normalizeAnswer(generation.generatedQuiz.mainAnswer);
					await increment(result.correctAnswerer, 'autogen-quiz-answer');

					const achievementMapping: Record<string, string> = {
						TSG: 'autogen-quiz-answer-main-answer-tsg',
						CHATGPT: 'autogen-quiz-answer-main-answer-chatgpt',
						クイズ: 'autogen-quiz-answer-main-answer-クイズ',
						コロンビア: 'autogen-quiz-answer-main-answer-コロンビア',
					};

					for (const [key, achievementKey] of Object.entries(achievementMapping)) {
						if (normalizedAnswer === key) {
							await increment(result.correctAnswerer, achievementKey);
						}
					}
					const memberName = await getMemberName(result.correctAnswerer);
					if (normalizedAnswer === normalizeAnswer(memberName)) {
						await increment(result.correctAnswerer, 'autogen-quiz-answer-main-answer-self-name');
					}
				}
			} catch (error) {
				log.error(error.stack);
				quizMessageDeferred.resolve(null);

				await this.slack.chat.postMessage({
					channel,
					text: `[autogen-quiz] エラーが発生しました: ${error.message}`,
				});
			}
		});

		return quizMessageDeferred.promise;
	}
}

export default (slackClients: SlackInterface) => {
	new AutogenQuizBot(slackClients);
};
