import { ChatPostMessageArguments, WebClient } from '@slack/web-api';
import type { EventEmitter } from 'events';
import { SlackInterface } from '../lib/slack';
import assert from 'assert';
import { Mutex } from 'async-mutex';
import { Deferred } from '../lib/utils';

export interface AteQuizProblem {
  problemMessage: ChatPostMessageArguments;
  hintMessages: ChatPostMessageArguments[];
  immediateMessage?: ChatPostMessageArguments;
  solvedMessage: ChatPostMessageArguments;
  unsolvedMessage: ChatPostMessageArguments;
  answerMessage?: ChatPostMessageArguments;
  correctAnswers: string[];
  incorrectMessage?: ChatPostMessageArguments;
}

type AteQuizState = 'waiting' | 'solving' | 'solved' | 'unsolved';

export interface AteQuizResult {
  quiz: AteQuizProblem;
  state: 'solved' | 'unsolved';
  correctAnswerer: string | null;
  hintIndex: number | null;
}

export interface NormalAteQuizStartOption {
  mode: 'normal';
}

export interface SoloAteQuizStartOption {
  mode: 'solo';
  player: string;
}

export type AteQuizStartOption = NormalAteQuizStartOption | SoloAteQuizStartOption;

export const typicalAteQuizHintTexts = [
  'しょうがないにゃあ、ヒントだよ',
  'もう一つヒントだよ、早く答えてね',
  'まだわからないの？ヒント追加するからね',
  '最後のヒントだよ！もうわかるよね？',
];

/**
 * Generator functions for typical quiz messages.
 * In default, a subtext '[[!user]]' automatically replaced with the message.user in solvedMessage.
 */
export const typicalMessageTextsGenerator = {
  problem: (genre: string): string => `この${genre}なーんだ`,
  immediate: (): string => '15秒経過でヒントを出すよ♫',
  solved: (answer: string): string =>
    `<@[[!user]]> 正解:tada:\n答えは${answer}だよ:muscle:`,
  unsolved: (answer: string): string =>
    `もう、しっかりして！\n答えは${answer}だよ:anger:`,
};

/**
 * A Class for XX当てクイズ for #sandbox.
 * Channels of hints must be same as problem channel. thread_ts will be ignored.
 * To use other judge/watSecGen/ngReaction, please extend this class.
 */
export class AteQuiz {
  eventClient: EventEmitter;
  slack: WebClient;
  problem: AteQuizProblem;
  ngReaction: string | null = 'no_good';
  state: AteQuizState = 'waiting';
  replaceKeys: { correctAnswerer: string } = { correctAnswerer: '[[!user]]' };
  mutex: Mutex;
  postOption: ChatPostMessageArguments;
  threadTsDeferred: Deferred<string> = new Deferred();

  judge(answer: string, _user: string): boolean {
    return this.problem.correctAnswers.some(
      (correctAnswer) => answer === correctAnswer
    );
  }

  waitSecGen(hintIndex: number): number {
    return hintIndex === this.problem.hintMessages.length ? 30 : 15;
  }

  /**
   * Generate solved message.
   * @param {any} post the post judged as correct
   * @returns a object that specifies the parameters of a solved message
   */
  solvedMessageGen(post: any): ChatPostMessageArguments | Promise<ChatPostMessageArguments> {
    const message = Object.assign({}, this.problem.solvedMessage);
    message.text = message.text.replaceAll(
      this.replaceKeys.correctAnswerer,
      post.user as string
    );
    return message;
  }

  answerMessageGen(_post?: any): ChatPostMessageArguments | null | Promise<ChatPostMessageArguments | null> {
    if (!this.problem.answerMessage) {
      return null;
    }
    return this.problem.answerMessage;
  }

  incorrectMessageGen(post: any): ChatPostMessageArguments | null {
    if (!this.problem.incorrectMessage) {
      return null;
    }
    const message = Object.assign({}, this.problem.incorrectMessage);
    message.text = message.text.replaceAll(
      this.replaceKeys.correctAnswerer,
      post.user as string
    );
    return message;
  }

  constructor(
    { eventClient, webClient: slack }: SlackInterface,
    problem: AteQuizProblem,
    option?: ChatPostMessageArguments,
  ) {
    this.eventClient = eventClient;
    this.slack = slack;
    this.problem = problem;
    this.postOption = option ? JSON.parse(JSON.stringify(option)) : option;

    assert(
      this.problem.hintMessages.every(
        (hint) => hint.channel === this.problem.problemMessage.channel
      )
    );

    this.mutex = new Mutex();
  }

  async repostProblemMessage() {
    const threadTs = await this.threadTsDeferred.promise;
    return this.slack.chat.postMessage({
      ...Object.assign({}, this.problem.problemMessage, this.postOption),
      thread_ts: threadTs,
      reply_broadcast: true,
    });
  }

  /**
   * Start AteQuiz.
   * @returns A promise of AteQuizResult that becomes resolved when the quiz ends.
   */
  async start(startOption?: AteQuizStartOption): Promise<AteQuizResult> {
    const _option = Object.assign(
      { mode: 'normal' } as AteQuizStartOption,
      startOption
    );
    this.state = 'solving';

    const postMessage = (message: ChatPostMessageArguments) => {
      const toSend = Object.assign({}, message, this.postOption);
      return this.slack.chat.postMessage(toSend);
    };

    const result: AteQuizResult = {
      quiz: this.problem,
      state: 'unsolved',
      correctAnswerer: null,
      hintIndex: null,
    };

    let previousHintTime: number = null;
    let hintIndex = 0;

    const deferred = new Deferred<AteQuizResult>();

    const onTick = () => {
      this.mutex.runExclusive(async () => {
        const now = Date.now();
        const nextHintTime =
          previousHintTime + 1000 * this.waitSecGen(hintIndex);
        if (this.state === 'solving' && nextHintTime <= now) {
          previousHintTime = now;
          if (hintIndex < this.problem.hintMessages.length) {
            const hint = this.problem.hintMessages[hintIndex];
            await postMessage(Object.assign({}, hint, { thread_ts }));
            hintIndex++;
          } else {
            this.state = 'unsolved';
            await postMessage(
              Object.assign({}, this.problem.unsolvedMessage, { thread_ts })
            );

            const answerMessage = await this.answerMessageGen();
            if (answerMessage) {
              await postMessage(
                Object.assign({}, answerMessage, { thread_ts })
              );
            }
            clearInterval(tickTimer);
            deferred.resolve(result);
          }
        }
      });
    };

    this.eventClient.on('message', async (message) => {
      if (message.thread_ts === thread_ts) {
        if (message.subtype === 'bot_message') return;
        if (_option.mode === 'solo' && message.user !== _option.player) return;
        this.mutex.runExclusive(async () => {
          if (this.state === 'solving') {
            const answer = message.text as string;
            const isCorrect = this.judge(answer, message.user as string);
            if (isCorrect) {
              this.state = 'solved';
              clearInterval(tickTimer);

              await postMessage(
                Object.assign({}, await this.solvedMessageGen(message), { thread_ts })
              );

              const answerMessage = await this.answerMessageGen(message);
              if (answerMessage) {
                await postMessage(
                  Object.assign({}, answerMessage, { thread_ts })
                );
              }

              result.correctAnswerer = message.user;
              result.hintIndex = hintIndex;
              result.state = 'solved';
              deferred.resolve(result);
            } else {
              const generatedMessage = this.incorrectMessageGen(message);
              if (this.ngReaction) {
                this.slack.reactions.add({
                  name: this.ngReaction,
                  channel: message.channel,
                  timestamp: message.ts,
                });
              }
              if (generatedMessage) {
                await postMessage(
                  Object.assign({}, generatedMessage, { thread_ts })
                );
              }
            }
          }
        });
      }
    });

    // Listeners should be added before postMessage is called.
    const response = await postMessage(this.problem.problemMessage);
    const thread_ts = response?.message?.thread_ts ?? response.ts;
    this.threadTsDeferred.resolve(thread_ts);
    assert(typeof thread_ts === 'string');

    if (this.problem.immediateMessage) {
      await postMessage(
        Object.assign({}, this.problem.immediateMessage, { thread_ts })
      );
    }
    previousHintTime = Date.now();
    const tickTimer = setInterval(onTick, 1000);

    return deferred.promise;
  }
}
