"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable init-declarations */
/* eslint-disable array-plural/array-plural */
require("dotenv/config");
const assert_1 = require("assert");
const path_1 = __importDefault(require("path"));
const querystring_1 = __importDefault(require("querystring"));
const util_1 = require("util");
const async_mutex_1 = require("async-mutex");
const axios_1 = __importDefault(require("axios"));
const common_tags_1 = require("common-tags");
const eastasianwidth_1 = __importDefault(require("eastasianwidth"));
const fs_extra_1 = require("fs-extra");
const js_yaml_1 = __importDefault(require("js-yaml"));
const lodash_1 = require("lodash");
// @ts-ignore: untyped
const node_emoji_1 = __importDefault(require("node-emoji"));
const zod_1 = require("zod");
const achievements_1 = require("../achievements");
const atequiz_1 = require("../atequiz");
const hayaoshiUtils_1 = require("../discord/hayaoshiUtils");
const channelLimitedBot_1 = require("../lib/channelLimitedBot");
const logger_1 = __importDefault(require("../lib/logger"));
const openai_1 = __importDefault(require("../lib/openai"));
const slackUtils_1 = require("../lib/slackUtils");
const utils_1 = require("../lib/utils");
const genres_1 = __importDefault(require("./genres"));
const mutex = new async_mutex_1.Mutex();
const log = logger_1.default.child({ bot: 'autogen-quiz' });
const GeneratedQuiz = zod_1.z.object({
    question: zod_1.z.string().nonempty(),
    mainAnswer: zod_1.z.string().nonempty(),
    alternativeAnswers: zod_1.z.array(zod_1.z.string().nonempty()),
});
const WikipediaPagesResponse = zod_1.z.object({
    query: zod_1.z.object({
        pages: zod_1.z.record(zod_1.z.object({
            extract: zod_1.z.string(),
        })),
    }),
});
const promptsLoader = new utils_1.Loader(async () => {
    const prompts = await Promise.all(['wikipedia'].map(async (filename) => {
        const promptYaml = await (0, fs_extra_1.readFile)(path_1.default.join(__dirname, 'prompts', `${filename}.yaml`));
        const prompt = js_yaml_1.default.load(promptYaml.toString());
        return [filename, prompt];
    }));
    return Object.fromEntries(prompts);
});
const getPlaintextWikipedia = async (title) => {
    log.info(`Getting wikipedia ${title}...`);
    const url = `https://ja.wikipedia.org/w/api.php?${querystring_1.default.encode({
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
const extractBulletTitles = (content) => {
    const bulletRegex = /^(?:\*|\+|-|\d+\.)\s*(.+)$/gm;
    const titles = [];
    let match;
    while ((match = bulletRegex.exec(content)) !== null) {
        titles.push(match[1]);
    }
    return titles;
};
const formatTemplate = (content, params = {}) => {
    let result = content;
    for (const [key, value] of Object.entries(params)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }
    let match = null;
    if ((match = result.match(/\{\{.*?\}\}/g)) !== null) {
        throw new assert_1.AssertionError({
            message: `Unresolved template variables: ${match.join(', ')}`,
        });
    }
    return result.trim();
};
const getBraveSearchResult = async (query) => {
    const { data } = await axios_1.default.get('https://api.search.brave.com/res/v1/web/search', {
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
const generateQuizWikipediaMethod = async (genre, bigGenre = null) => {
    const prompts = await promptsLoader.load();
    const chatHistory = [];
    chatHistory.push({
        role: 'user',
        content: bigGenre === null
            ? formatTemplate(prompts.wikipedia.enumerate_topics, { genre })
            : formatTemplate(prompts.wikipedia.enumerate_topics_with_big_genre, {
                genre,
                big_genre: bigGenre,
            }),
    });
    const response1 = await openai_1.default.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        max_tokens: 1024,
    });
    const resultMessage1 = response1?.choices?.[0]?.message;
    log.info(`Response: ${(0, util_1.inspect)(resultMessage1)}`);
    if (!resultMessage1?.content) {
        log.info('No content found in the response');
        return null;
    }
    chatHistory.push(resultMessage1);
    const topics = extractBulletTitles(resultMessage1.content);
    log.info(`Extracted topics: ${(0, util_1.inspect)(topics)}`);
    if (topics.length === 0) {
        log.info('No topics found in the content');
        return null;
    }
    const selectedTopic = (0, lodash_1.sample)(topics);
    log.info(`Selected topic: ${(0, util_1.inspect)(selectedTopic)}`);
    const braveSearchResults = await getBraveSearchResult([
        genre,
        selectedTopic,
        'site:ja.wikipedia.org',
    ].join(' '));
    const wikipediaCandidates = braveSearchResults.slice(0, 5).map((result) => (result.title.split(' - ')[0]));
    const wikipediaCandidatesText = wikipediaCandidates.map((title) => `* ${title}`).join('\n');
    chatHistory.push({
        role: 'user',
        content: formatTemplate(prompts.wikipedia.select_wikipedia, {
            genre,
            topic: selectedTopic,
            wikipedia_candidates: wikipediaCandidatesText,
        }),
    });
    const response2 = await openai_1.default.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        max_tokens: 1024,
    });
    const resultMessage2 = response2?.choices?.[0]?.message;
    log.info(`Response: ${(0, util_1.inspect)(resultMessage2)}`);
    if (!resultMessage2?.content) {
        log.info('No content found in the response');
        return null;
    }
    chatHistory.push(resultMessage2);
    let selectedWikipedia;
    if (!resultMessage2.content.includes('いいえ、ありません')) {
        const sortedWikipediaCandidates = (0, lodash_1.sortBy)(wikipediaCandidates, (candidate) => candidate.length).reverse();
        selectedWikipedia = sortedWikipediaCandidates.find((candidate) => (resultMessage2.content.toLowerCase().includes(candidate.toLowerCase())));
    }
    log.info(`Selected Wikipedia: ${(0, util_1.inspect)(selectedWikipedia)}`);
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
        }
        catch (error) {
            log.error(`Failed to get Wikipedia content: ${error.message}`);
            chatHistory.push({
                role: 'user',
                content: formatTemplate(prompts.wikipedia.enumerate_answers_without_wikipedia, {
                    genre,
                    topic: selectedTopic,
                }),
            });
        }
    }
    else {
        chatHistory.push({
            role: 'user',
            content: formatTemplate(prompts.wikipedia.enumerate_answers_without_wikipedia, {
                genre,
                topic: selectedTopic,
            }),
        });
    }
    const response3 = await openai_1.default.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        max_tokens: 1024,
    });
    const resultMessage3 = response3?.choices?.[0]?.message;
    log.info(`Response: ${(0, util_1.inspect)(resultMessage3)}`);
    if (!resultMessage3?.content) {
        log.info('No content found in the response');
        return null;
    }
    chatHistory.push(resultMessage3);
    const answerCandidates = extractBulletTitles(resultMessage3.content).filter((title) => (!genre.includes(title)));
    if (answerCandidates.length === 0) {
        log.info('No answer candidates found in the content');
        return null;
    }
    const selectedAnswer = (0, lodash_1.sample)(answerCandidates);
    log.info(`Selected answer: ${(0, util_1.inspect)(selectedAnswer)}`);
    chatHistory.push({
        role: 'user',
        content: formatTemplate(prompts.wikipedia.generate_quiz, {
            genre,
            topic: selectedTopic,
            answer: selectedAnswer,
        }),
    });
    const response4 = await openai_1.default.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        max_tokens: 1024,
    });
    const resultMessage4 = response4?.choices?.[0]?.message;
    log.info(`Response: ${(0, util_1.inspect)(resultMessage4)}`);
    if (!resultMessage4?.content) {
        log.info('No content found in the response');
        return null;
    }
    chatHistory.push(resultMessage4);
    chatHistory.push({
        role: 'user',
        content: formatTemplate(prompts.wikipedia.generate_alternative_answers),
    });
    const response5 = await openai_1.default.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        max_tokens: 1024,
    });
    const resultMessage5 = response5?.choices?.[0]?.message;
    log.info(`Response: ${(0, util_1.inspect)(resultMessage5)}`);
    if (!resultMessage5?.content) {
        log.info('No content found in the response');
        return null;
    }
    chatHistory.push(resultMessage5);
    chatHistory.push({
        role: 'user',
        content: formatTemplate(prompts.wikipedia.generate_quiz_json),
    });
    const response6 = await openai_1.default.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        max_tokens: 1024,
    });
    const resultMessage6 = response6?.choices?.[0]?.message;
    log.info(`Response: ${(0, util_1.inspect)(resultMessage6)}`);
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
        log.info(`Parsed quiz JSON: ${(0, util_1.inspect)(parsedQuiz)}`);
        const quiz = GeneratedQuiz.parse(parsedQuiz);
        return {
            generatedQuiz: quiz,
            genre,
            topic: selectedTopic,
            wikipediaTitle: selectedWikipedia,
        };
    }
    catch (error) {
        log.error(`Failed to parse quiz JSON: ${error.message}`);
        return null;
    }
};
const generateQuiz = (genre) => {
    if (!genre) {
        const bigGenre = (0, lodash_1.sample)(Object.keys(genres_1.default));
        const smallGenre = (0, lodash_1.sample)(genres_1.default[bigGenre]);
        return generateQuizWikipediaMethod(smallGenre, bigGenre);
    }
    return generateQuizWikipediaMethod(genre);
};
const normalizeGenre = (genre) => {
    const normalizedGenre = genre.normalize('NFKC').replace(/\s+/g, ' ').trim();
    return node_emoji_1.default.emojify(normalizedGenre);
};
const normalizeAnswer = (answer) => (answer.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase());
class AutogenQuiz extends atequiz_1.AteQuiz {
    constructor(options) {
        super(options.slack, options.problem, options.postOptions);
    }
    waitSecGen(_hintIndex) {
        return 30;
    }
    async judge(answer) {
        const judgeResult = await (0, hayaoshiUtils_1.judgeAnswer)(this.problem.correctAnswers, answer);
        return judgeResult === 'correct';
    }
}
class AutogenQuizBot extends channelLimitedBot_1.ChannelLimitedBot {
    wakeWordRegex = /^(ランダムクイズ|(?<genre>.+?)のクイズ)$/u;
    username = 'ChatGPT';
    iconEmoji = ':chatgpt:';
    onWakeWord(message, channel) {
        const quizMessageDeferred = new utils_1.Deferred();
        mutex.runExclusive(async () => {
            try {
                const matches = this.wakeWordRegex.exec(message.text);
                const genre = matches?.groups?.genre ?? null;
                const normalizedGenre = genre ? normalizeGenre(genre) : null;
                if (normalizedGenre && eastasianwidth_1.default.length(normalizedGenre) > 24) {
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
                    const { ts } = await this.slack.chat.postMessage({
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
                const quizText = (0, common_tags_1.stripIndent) `
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
                            text: atequiz_1.typicalMessageTextsGenerator.solved(` ＊${generation.generatedQuiz.mainAnswer}＊ `),
                        },
                        unsolvedMessage: {
                            channel,
                            text: atequiz_1.typicalMessageTextsGenerator.unsolved(` ＊${generation.generatedQuiz.mainAnswer}＊ `),
                        },
                        answerMessage: {
                            channel,
                            text: (0, common_tags_1.stripIndent) `
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
                log.info(`Quiz result: ${(0, util_1.inspect)(result)}`);
                if (result.state === 'solved') {
                    const normalizedAnswer = normalizeAnswer(generation.generatedQuiz.mainAnswer);
                    await (0, achievements_1.increment)(result.correctAnswerer, 'autogen-quiz-answer');
                    const achievementMapping = {
                        TSG: 'autogen-quiz-answer-main-answer-tsg',
                        CHATGPT: 'autogen-quiz-answer-main-answer-chatgpt',
                        クイズ: 'autogen-quiz-answer-main-answer-クイズ',
                        コロンビア: 'autogen-quiz-answer-main-answer-コロンビア',
                    };
                    for (const [key, achievementKey] of Object.entries(achievementMapping)) {
                        if (normalizedAnswer === key) {
                            await (0, achievements_1.increment)(result.correctAnswerer, achievementKey);
                        }
                    }
                    const memberName = await (0, slackUtils_1.getMemberName)(result.correctAnswerer);
                    if (normalizedAnswer === normalizeAnswer(memberName)) {
                        await (0, achievements_1.increment)(result.correctAnswerer, 'autogen-quiz-answer-main-answer-self-name');
                    }
                }
            }
            catch (error) {
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
exports.default = (slackClients) => {
    new AutogenQuizBot(slackClients);
};
