import { WebClient } from '@slack/web-api';
import { RTMClient } from '@slack/rtm-api';
import { SlackInterface } from '../lib/slack';
import { ChatPostMessageArguments } from '@slack/web-api/dist/methods';
import assert from 'assert';
import { Mutex } from 'async-mutex';
import { Deferred } from '../lib/utils';

export interface AteQuizProblem {
  problem: ChatPostMessageArguments;
  hints: ChatPostMessageArguments[];
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

  constructor(
    { rtmClient: rtm, webClient: slack }: SlackInterface,
    quiz: AteQuizProblem
  ) {
    this.rtm = rtm;
    this.slack = slack;
    this.quiz = quiz;
    this.waitSecGen =
      quiz.waitSecGen ?? ((hintIndex: number) => (hintIndex === 0 ? 30 : 15));

    assert(
      this.quiz.hints.every(hint => hint.channel === this.quiz.problem.channel)
    );

    if (!this.quiz.judge) {
      this.quiz.judge = (correctAnswers: string[], answer: string) => {
        return correctAnswers.some(correctAnswer => answer === correctAnswer);
      };
    }

    this.mutex = new Mutex();

    return this;
  }

  start = async (): Promise<AteQuizResult> => {
    this.state = 'solving';

    const { ts: thread_ts } = await this.slack.chat.postMessage(
      this.quiz.problem
    );
    assert(typeof thread_ts === 'string');

    const result: AteQuizResult = {
      quiz: this.quiz,
      state: 'unsolved',
      correctAnswerer: null,
      hintIndex: null,
    };

    let previousHintTime = 0;
    let hintIndex = 0;

    const deffered = new Deferred<AteQuizResult>();

    const onTick = () => {
      this.mutex.runExclusive(async () => {
        const now = Date.now();
        const nextHintTime = previousHintTime + this.waitSecGen(hintIndex);

        if (this.state === 'solving' && nextHintTime <= now) {
          previousHintTime = now;
          if (hintIndex < this.quiz.hints.length) {
            const hint = this.quiz.hints[hintIndex];
            await this.slack.chat.postMessage(
              Object.assign(hint, { thread_ts })
            );
            hintIndex++;
          } else {
            this.state = 'unsolved';
            await this.slack.chat.postMessage(
              Object.assign(this.quiz.unsolvedMessage, {
                thread_ts,
              })
            );
            await this.slack.chat.postMessage(
              Object.assign(this.quiz.answerMessage, {
                thread_ts,
              })
            );
            clearInterval(tickTimer);
            deffered.resolve(result);
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
            await this.slack.chat.postMessage(
              Object.assign(this.quiz.solvedMessage, {
                thread_ts,
              })
            );
            await this.slack.chat.postMessage(
              Object.assign(this.quiz.answerMessage, {
                thread_ts,
              })
            );
            result.correctAnswerer = message.user;
            result.hintIndex = hintIndex;
            result.state = 'solved';
            deffered.resolve(result);
          } else {
            this.slack.reactions.add({
              name: this.quiz.ngReaction ?? 'no_good',
            });
          }
        }
      }
    });

    return deffered.promise;
  };
}
