import { Mutex } from 'async-mutex';
import cheerio from 'cheerio';
import axios from 'axios';
import { sample, random } from 'lodash';
import type { SlackInterface } from '../lib/slack';
import { AteQuizProblem, AteQuiz, typicalMessageTextsGenerator } from '../atequiz';
import { isCorrectAnswer } from '../hayaoshi';
import { unlock, increment } from '../achievements';

const mutex = new Mutex();
const decoder = new TextDecoder('shift-jis');
const commonOption = { username: "bungo", icon_emoji: ':black_nib:' };
const channel = process.env.CHANNEL_SANDBOX;
const initialHintTextLength = 20;
const normalHintTextLength = 50;
const normalHintTimes = 3;
const finalHintTextLength = 50;

const removeWhiteSpaces = (text: string) => {
  return text.replace(/\s/g, '');
};

const fetchCards = async () => {
  const accessRankingBase = "https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/access_ranking/";
  const { data: rankingData } = await axios.get<string>(accessRankingBase + "index.html");
  const [ latestBest500File, year, month ] = rankingData.match(/(\d+)_(\d+)_xhtml.html/);
  const { data: best500Data } = await axios.get<string>(accessRankingBase + latestBest500File);
  return {
    cards: best500Data.match(/http.*\/cards\/\d+\/card\d+.html/g),
    year,
    month
  };
};

const fetchCorpus = async (cardURL: string) => {
  const [cardRelPath, cardFolder, cardNumber] = cardURL.match(/cards\/(\d+)\/card(\d+).html/);
  const { data: cardData } = await axios.get<string>(
    `https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/${cardRelPath}`,
  );
  const fileStem = cardData.match(`a href="./files/(${cardNumber}_\\d+).html"`)[1];
  const fileRelPath = `cards/${cardFolder}/files/${fileStem}.html`;
  const { data } = await axios.get<string>(
    `https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/${fileRelPath}`,
    {
      responseType: 'arraybuffer',
      transformResponse: (data: ArrayBuffer) => {
        return decoder.decode(Buffer.from(data));
      },
    },
  );
  const $ = cheerio.load(data);
  const wholeText = removeWhiteSpaces(
    $('.main_text').children().map((_, e) => $(e).text() + $(e.next).text()).toArray().join("")
  );
  const title = $('.title').text();
  const author = $('.author').text();

  const hints: string[] = [];
  const finalHint = wholeText.slice(0, finalHintTextLength);
  const hintCorpus = wholeText.slice(finalHintTextLength);

  const begin = random(hintCorpus.length - initialHintTextLength);
  const end = begin + initialHintTextLength;
  const initialHint = hintCorpus.slice(begin, end);

  hints.push(initialHint);
  for (let i = 0; i < normalHintTimes; i++) {
    const begin = random(hintCorpus.length - normalHintTextLength);
    const end = begin + normalHintTextLength;
    hints.push(wholeText.slice(begin, end));
  }
  hints.push(finalHint);

  return {hints, title, author};
};


export default ({ rtmClient: rtm, webClient: slack }: SlackInterface) => {
  rtm.on('message', (message) => {
    if (message.channel !== process.env.CHANNEL_SANDBOX) {
      return;
    }

    mutex.runExclusive(async () => {
      const debugInfo = [];
      try {
        if (message.text && (message.text === '文豪クイズ')) {
          const { cards, year, month } = await fetchCards();
          debugInfo.push(`ranking: ${year}/${month}`);
          const cardURL = sample(cards);
          debugInfo.push(`URL: ${cardURL}`);
          const {hints, title, author} = await fetchCorpus(cardURL);
          const problem: AteQuizProblem = {
            problemMessage: { channel, text: `この作品のタイトルは何でしょう？\n> ${hints[0]}` },
            hintMessages: [
              ...hints.slice(1, -1).map((text, index, arr) => {
                if (index < arr.length - 1)
                  return { channel, text: `次のヒントです！\n> ${text}` }
                else
                  return { channel, text: `次のヒントです！作者は${author}ですよ～\n> ${text}` }
              }),
              { channel, text: `最後のヒントです！\n> ${hints[hints.length - 1]}` },
            ],
            immediateMessage: { channel, text: "15秒でヒントです！" },
            solvedMessage: {
              channel,
              text: typicalMessageTextsGenerator.solved(` *${title}* (${author}) `),
              reply_broadcast: true,
            },
            unsolvedMessage: {
              channel,
              text: typicalMessageTextsGenerator.unsolved(` *${title}* (${author}) `),
              reply_broadcast: true,
            },
            answerMessage: { channel, text: cardURL },
            correctAnswers: [title],
          };

          const quiz = new AteQuiz(
            { rtmClient: rtm, webClient: slack } as SlackInterface,
            problem,
            commonOption,
          );
          const result = await quiz.start();
          if (result.state === 'solved') {
            await increment(result.correctAnswerer, 'bungo-answer');
            if (result.hintIndex === 0) {
              await unlock(result.correctAnswerer, 'bungo-answer-first-hint');
            }
          }
        }

        if (message.text && (message.text === '文豪当てクイズ')) {
          const { cards, year, month } = await fetchCards();
          debugInfo.push(`ranking: ${year}/${month}`);
          const cardURL = sample(cards);
          debugInfo.push(`URL: ${cardURL}`);
          const {hints, title, author} = await fetchCorpus(cardURL);
          const problem: AteQuizProblem = {
            problemMessage: { channel, text: `この作品の作者は誰でしょう？\n> ${hints[0]}` },
            hintMessages: [
              ...hints.slice(1, -1).map((text, index, arr) => {
                return { channel, text: `次のヒントです！\n> ${text}` }
              }),
              { channel, text: `最後のヒントです！作品名は${title}ですよ～\n> ${hints[hints.length - 1]}` },
            ],
            immediateMessage: { channel, text: "15秒でヒントです！" },
            solvedMessage: {
              channel,
              text: typicalMessageTextsGenerator.solved(` *${author}* (${title}) `),
              reply_broadcast: true,
            },
            unsolvedMessage: {
              channel,
              text: typicalMessageTextsGenerator.unsolved(` *${author}* (${title}) `),
              reply_broadcast: true,
            },
            answerMessage: { channel, text: cardURL },
            correctAnswers: author.split("　"),
          };

          const quiz = new AteQuiz(
            { rtmClient: rtm, webClient: slack } as SlackInterface,
            problem,
            commonOption,
          );
          quiz.judge = (answer: string) => {
            return quiz.problem.correctAnswers.some(
              correctAnswer => isCorrectAnswer(correctAnswer, answer)
            );
          };
          const result = await quiz.start();
          if (result.state === 'solved') {
            await increment(result.correctAnswerer, 'bungo-answer');
            if (result.hintIndex === 0) {
              await unlock(result.correctAnswerer, 'bungo-answer-first-hint');
            }
          }
        }
      } catch (error) {
        await slack.chat.postMessage({
          channel: process.env.CHANNEL_SANDBOX,
          text: `エラー😢\n${error.toString()}\n--debugInfo--\n${debugInfo.join('\n')}`,
          ...commonOption,
        });
      }
    });
  });
};
