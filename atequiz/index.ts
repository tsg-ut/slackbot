import { WebAPICallOptions, WebClient } from '@slack/web-api';
import { SlackInterface } from '../lib/slack';
import { ChatPostMessageArguments } from '@slack/web-api/dist/methods';
import assert from 'assert';
import { Mutex } from 'async-mutex';
import { Deferred } from '../lib/utils';
import logger from '../lib/logger';
import type { GenericMessageEvent, MessageEvent } from '@slack/bolt';
import { extractMessage, isBotMessage } from '../lib/slackUtils';

const log = logger.child({ bot: 'atequiz' });

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
  eventClient: SlackInterface['eventClient'];
  slack: WebClient;
  problem: AteQuizProblem;
  ngReaction: string | null = 'no_good';
  state: AteQuizState = 'waiting';
  replaceKeys: { correctAnswerer: string } = { correctAnswerer: '[[!user]]' };
  mutex: Mutex = new Mutex();
  deferred: Deferred<AteQuizResult> = new Deferred();
  postOption: WebAPICallOptions;
  threadTsDeferred: Deferred<string> = new Deferred();
  tickTimer: NodeJS.Timeout | null = null;

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
  solvedMessageGen(post: GenericMessageEvent): ChatPostMessageArguments | Promise<ChatPostMessageArguments> {
    const message = Object.assign({}, this.problem.solvedMessage);
    message.text = message.text.replaceAll(
      this.replaceKeys.correctAnswerer,
      post.user as string
    );
    return message;
  }

  answerMessageGen(_post?: GenericMessageEvent): ChatPostMessageArguments | null | Promise<ChatPostMessageArguments | null> {
    if (!this.problem.answerMessage) {
      return null;
    }
    return this.problem.answerMessage;
  }

  incorrectMessageGen(post: GenericMessageEvent): ChatPostMessageArguments | null {
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
    option?: WebAPICallOptions
  ) {
    this.eventClient = eventClient;
    this.slack = slack;
    this.problem = JSON.parse(JSON.stringify(problem));
    this.postOption = option ? JSON.parse(JSON.stringify(option)) : option;

    assert(
      this.problem.hintMessages.every(
        (hint) => hint.channel === this.problem.problemMessage.channel
      )
    );
  }

  async repostProblemMessage() {
    const threadTs = await this.threadTsDeferred.promise;
    return this.slack.chat.postMessage({
      ...this.problem.problemMessage,
      ...this.postOption,
      thread_ts: threadTs,
      reply_broadcast: true,
    });
  }

  /**
   * Start AteQuiz.
   * @returns A promise of AteQuizResult that becomes resolved when the quiz ends.
   */
  async start(startOption?: AteQuizStartOption): Promise<AteQuizResult> {
    if (this.state !== 'waiting') {
      throw new Error('AteQuiz is already started');
    }

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

    const onTick = () => {
      this.mutex.runExclusive(async () => {
        try {
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
              clearInterval(this.tickTimer);
              this.deferred.resolve(result);
            }
          }
        } catch (error) {
          log.error(error?.stack);
          this.deferred.reject(error);
          this.abort();

          await postMessage({
            username: 'AteQuiz',
            channel: this.problem.problemMessage.channel,
            text: `エラーが発生しました。\n${error?.stack}`,
            thread_ts,
          });
        }
      });
    };

    this.eventClient.on('message', async (messageEvent: MessageEvent) => {
      const message = extractMessage(messageEvent);

      if (message !== null && message.thread_ts === thread_ts) {
        if (isBotMessage(message)) return;
        if (_option.mode === 'solo' && message.user !== _option.player) return;
        this.mutex.runExclusive(async () => {
          if (this.state === 'solving') {
            const answer = message.text as string;
            const isCorrect = this.judge(answer, message.user as string);
            if (isCorrect) {
              this.state = 'solved';
              clearInterval(this.tickTimer);

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
              this.deferred.resolve(result);
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
    this.tickTimer = setInterval(onTick, 1000);

    return this.deferred.promise;
  }

  abort() {
    this.state = 'unsolved';
    clearInterval(this.tickTimer);
  }
}
