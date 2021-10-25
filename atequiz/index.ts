import { WebAPICallOptions, WebClient } from '@slack/web-api';
import { RTMClient } from '@slack/rtm-api';
import { SlackInterface } from '../lib/slack';
import { ChatPostMessageArguments } from '@slack/web-api/dist/methods';
import assert from 'assert';
import { Mutex } from 'async-mutex';
import { Deferred } from '../lib/utils';

export interface AteQuizProblem {
  problem: ChatPostMessageArguments;
  hints: ChatPostMessageArguments[];
  immediateMessage: ChatPostMessageArguments;
  solvedMessage: ChatPostMessageArguments;
  unsolvedMessage: ChatPostMessageArguments;
  answerMessage: ChatPostMessageArguments;
  ngReaction?: string;
  correctAnswers: string[];
  judge?: (correctAnswers: string[], answer: string) => boolean;
  waitSecGen?: (hintIndex: number) => number;
}

type AteQuizState = 'waiting' | 'solving' | 'solved' | 'unsolved';

export interface AteQuizResult {
  quiz: AteQuizProblem;
  state: 'solved' | 'unsolved';
  correctAnswerer: string | null;
  hintIndex: number | null;
}

/**
 * A Class for XX当てクイズ for #sandbox.
 * Channels of hints must be same as problem channel. thread_ts will be ignored.
 */
export class AteQuiz {
  rtm: RTMClient;
  slack: WebClient;
  quiz: AteQuizProblem;

  private waitSecGen: (hintIndex: number) => number;
  private state: AteQuizState = 'waiting';
  private mutex: Mutex;
  private postOption: WebAPICallOptions;

  constructor(
    { rtmClient: rtm, webClient: slack }: SlackInterface,
    quiz: AteQuizProblem,
    option?: WebAPICallOptions
  ) {
    this.rtm = rtm;
    this.slack = slack;
    this.quiz = quiz;
    this.waitSecGen =
      quiz.waitSecGen ?? ((hintIndex: number) => (hintIndex === 0 ? 30 : 15));
    this.postOption = option ?? {};

    assert(
      this.quiz.hints.every(hint => hint.channel === this.quiz.problem.channel)
    );

    if (!this.quiz.judge) {
      this.quiz.judge = (correctAnswers: string[], answer: string) => {
        return correctAnswers.some(correctAnswer => answer === correctAnswer);
      };
    }

    this.mutex = new Mutex();
  }

  /**
   * Start AteQuiz.
   * @returns A promise that resolves when the quiz is solved.
   */
  start = async (): Promise<AteQuizResult> => {
    this.state = 'solving';

    const postMessage = async (message: ChatPostMessageArguments) => {
      return await this.slack.chat.postMessage(
        Object.assign(message, this.postOption)
      );
    };

    const { ts: thread_ts } = await postMessage(this.quiz.problem);
    assert(typeof thread_ts === 'string');
    await postMessage(Object.assign(this.quiz.immediateMessage, { thread_ts }));

    const result: AteQuizResult = {
      quiz: this.quiz,
      state: 'unsolved',
      correctAnswerer: null,
      hintIndex: null,
    };

    let previousHintTime = Date.now();
    let hintIndex = 0;

    const deferred = new Deferred<AteQuizResult>();

    const onTick = () => {
      this.mutex.runExclusive(async () => {
        const now = Date.now();
        const nextHintTime =
          previousHintTime + 1000 * this.waitSecGen(hintIndex);

        if (this.state === 'solving' && nextHintTime <= now) {
          previousHintTime = now;
          if (hintIndex < this.quiz.hints.length) {
            const hint = this.quiz.hints[hintIndex];
            await postMessage(Object.assign(hint, { thread_ts }));
            hintIndex++;
          } else {
            this.state = 'unsolved';
            await postMessage(
              Object.assign(this.quiz.unsolvedMessage, { thread_ts })
            );
            await postMessage(
              Object.assign(this.quiz.answerMessage, { thread_ts })
            );
            clearInterval(tickTimer);
            deferred.resolve(result);
          }
        }
      });
    };

    const tickTimer = setInterval(onTick, 1000);

    this.rtm.on('message', async message => {
      if (message.thread_ts === thread_ts) {
        if (this.state === 'solving') {
          const answer = message.text as string;
          const isCorrect = this.quiz.judge(this.quiz.correctAnswers, answer);
          if (isCorrect) {
            this.state = 'solved';
            clearInterval(tickTimer);

            await postMessage(
              Object.assign(this.quiz.solvedMessage, { thread_ts })
            );
            await postMessage(
              Object.assign(this.quiz.answerMessage, { thread_ts })
            );

            result.correctAnswerer = message.user;
            result.hintIndex = hintIndex;
            result.state = 'solved';
            deferred.resolve(result);
          } else {
            this.slack.reactions.add({
              name: this.quiz.ngReaction ?? 'no_good',
              channel: message.channel,
              timestamp: message.ts,
            });
          }
        }
      }
    });

    return deferred.promise;
  };
}
