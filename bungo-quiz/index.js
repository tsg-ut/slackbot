"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const async_mutex_1 = require("async-mutex");
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const lodash_1 = require("lodash");
const atequiz_1 = require("../atequiz");
const hayaoshi_1 = require("../hayaoshi");
const achievements_1 = require("../achievements");
const mutex = new async_mutex_1.Mutex();
const decoder = new TextDecoder('shift-jis');
const commonOption = { username: "bungo", icon_emoji: ':black_nib:' };
const channel = process.env.CHANNEL_SANDBOX;
const initialHintTextLength = 20;
const normalHintTextLength = 50;
const normalHintTimes = 3;
const finalHintTextLength = 50;
const removeWhiteSpaces = (text) => {
    return text.replace(/\s/g, '');
};
const fetchCards = async () => {
    const accessRankingBase = "https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/access_ranking/";
    const { data: rankingData } = await axios_1.default.get(accessRankingBase + "index.html");
    const [latestBest500File, year, month] = rankingData.match(/(\d+)_(\d+)_xhtml.html/);
    const { data: best500Data } = await axios_1.default.get(accessRankingBase + latestBest500File);
    return {
        cards: best500Data.match(/http.*\/cards\/\d+\/card\d+.html/g),
        year,
        month
    };
};
const fetchCorpus = async (cardURL) => {
    const [cardRelPath, cardFolder, cardNumber] = cardURL.match(/cards\/(\d+)\/card(\d+).html/);
    const { data: cardData } = await axios_1.default.get(`https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/${cardRelPath}`);
    const fileStem = cardData.match(`a href="./files/(${cardNumber}_\\d+).html"`)[1];
    const fileRelPath = `cards/${cardFolder}/files/${fileStem}.html`;
    const { data } = await axios_1.default.get(`https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/${fileRelPath}`, {
        responseType: 'arraybuffer',
        transformResponse: (data) => {
            return decoder.decode(Buffer.from(data));
        },
    });
    const $ = (0, cheerio_1.load)(data);
    const wholeText = removeWhiteSpaces($('.main_text').children().map((_, e) => $(e).text() + $(e.next).text()).toArray().join(""));
    const title = $('.title').text();
    const author = $('.author').text();
    const hints = [];
    const finalHint = wholeText.slice(0, finalHintTextLength);
    const hintCorpus = wholeText.slice(finalHintTextLength);
    const begin = (0, lodash_1.random)(hintCorpus.length - initialHintTextLength);
    const end = begin + initialHintTextLength;
    const initialHint = hintCorpus.slice(begin, end);
    hints.push(initialHint);
    for (let i = 0; i < normalHintTimes; i++) {
        const begin = (0, lodash_1.random)(hintCorpus.length - normalHintTextLength);
        const end = begin + normalHintTextLength;
        hints.push(wholeText.slice(begin, end));
    }
    hints.push(finalHint);
    return { hints, title, author };
};
exports.default = ({ eventClient, webClient: slack }) => {
    eventClient.on('message', (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        mutex.runExclusive(async () => {
            const debugInfo = [];
            try {
                if (message.text && (message.text === '文豪クイズ')) {
                    const { cards, year, month } = await fetchCards();
                    debugInfo.push(`ranking: ${year}/${month}`);
                    const cardURL = (0, lodash_1.sample)(cards);
                    debugInfo.push(`URL: ${cardURL}`);
                    const { hints, title, author } = await fetchCorpus(cardURL);
                    const problem = {
                        problemMessage: { channel, text: `この作品のタイトルは何でしょう？\n> ${hints[0]}` },
                        hintMessages: [
                            ...hints.slice(1, -1).map((text, index, arr) => {
                                if (index < arr.length - 1)
                                    return { channel, text: `次のヒントです！\n> ${text}` };
                                else
                                    return { channel, text: `次のヒントです！作者は${author}ですよ～\n> ${text}` };
                            }),
                            { channel, text: `最後のヒントです！\n> ${hints[hints.length - 1]}` },
                        ],
                        immediateMessage: { channel, text: "15秒でヒントです！" },
                        solvedMessage: {
                            channel,
                            text: atequiz_1.typicalMessageTextsGenerator.solved(` *${title}* (${author}) `),
                        },
                        unsolvedMessage: {
                            channel,
                            text: atequiz_1.typicalMessageTextsGenerator.unsolved(` *${title}* (${author}) `),
                        },
                        answerMessage: { channel, text: cardURL },
                        correctAnswers: [title],
                    };
                    const quiz = new atequiz_1.AteQuiz({ eventClient, webClient: slack }, problem, commonOption);
                    const result = await quiz.start();
                    if (result.state === 'solved') {
                        await (0, achievements_1.increment)(result.correctAnswerer, 'bungo-answer');
                        if (result.hintIndex === 0) {
                            await (0, achievements_1.unlock)(result.correctAnswerer, 'bungo-answer-first-hint');
                        }
                    }
                }
                if (message.text && (message.text === '文豪当てクイズ')) {
                    const { cards, year, month } = await fetchCards();
                    debugInfo.push(`ranking: ${year}/${month}`);
                    const cardURL = (0, lodash_1.sample)(cards);
                    debugInfo.push(`URL: ${cardURL}`);
                    const { hints, title, author } = await fetchCorpus(cardURL);
                    const problem = {
                        problemMessage: { channel, text: `この作品の作者は誰でしょう？\n> ${hints[0]}` },
                        hintMessages: [
                            ...hints.slice(1, -1).map((text, index, arr) => {
                                return { channel, text: `次のヒントです！\n> ${text}` };
                            }),
                            { channel, text: `最後のヒントです！作品名は${title}ですよ～\n> ${hints[hints.length - 1]}` },
                        ],
                        immediateMessage: { channel, text: "15秒でヒントです！" },
                        solvedMessage: {
                            channel,
                            text: atequiz_1.typicalMessageTextsGenerator.solved(` *${author}* (${title}) `),
                        },
                        unsolvedMessage: {
                            channel,
                            text: atequiz_1.typicalMessageTextsGenerator.unsolved(` *${author}* (${title}) `),
                        },
                        answerMessage: { channel, text: cardURL },
                        correctAnswers: author.split("　"),
                    };
                    const quiz = new atequiz_1.AteQuiz({ eventClient, webClient: slack }, problem, commonOption);
                    quiz.judge = (answer) => {
                        return quiz.problem.correctAnswers.some(correctAnswer => (0, hayaoshi_1.isCorrectAnswer)(correctAnswer, answer));
                    };
                    const result = await quiz.start();
                    if (result.state === 'solved') {
                        await (0, achievements_1.increment)(result.correctAnswerer, 'bungo-answer');
                        if (result.hintIndex === 0) {
                            await (0, achievements_1.unlock)(result.correctAnswerer, 'bungo-answer-first-hint');
                        }
                    }
                }
            }
            catch (error) {
                await slack.chat.postMessage({
                    channel: process.env.CHANNEL_SANDBOX,
                    text: `エラー😢\n${error.toString()}\n--debugInfo--\n${debugInfo.join('\n')}`,
                    ...commonOption,
                });
            }
        });
    });
};
