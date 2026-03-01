import type { GenericMessageEvent } from '@slack/web-api';
import type { MessageEvent } from '@slack/bolt';
import { range, shuffle, round } from 'lodash';
import { stripIndent } from 'common-tags';
import { unlock } from '../achievements';
import { extractMessage } from '../lib/slackUtils';
import { ChannelLimitedBot } from '../lib/channelLimitedBot';
import { Deferred } from '../lib/utils';
import type { SlackInterface } from '../lib/slack';
import assert from 'assert';

interface HitAndBlowHistory {
  call: number[];
  hitsCount: number;
  blowsCount: number;
}

class HitAndBlowState {
  answer: number[] = [];
  history: HitAndBlowHistory[] = [];
  channel: string | null = null;
  thread: string | null = null;
  startDate: number | null = null;
  timer: NodeJS.Timeout | null = null;
  inGame = false;
  clear() {
    this.answer = [];
    this.history = [];
    this.thread = null;
    this.startDate = null;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = null;
    this.inGame = false;
    return;
  }
}

const isValidCall = (call: number[]) => {
  const numDict = Array<number>(10).fill(0);
  for (let i = 0; i < call.length; i++) {
    if (numDict[call[i]] >= 1) {
      return false;
    }
    numDict[call[i]] = 1;
  }
  return true;
};

const countHit = (call: number[], answer: number[]) => {
  assert(call.length === answer.length);
  const hits = new Set<number>();
  for (let i = 0; i < call.length; i++) {
    if (call[i] === answer[i]) {
      hits.add(call[i]);
    }
  }
  return hits;
};

// Hitも合わせて数える
const countBlow = (call: number[], answer: number[]) => {
  assert(call.length === answer.length);
  const blows = new Set<number>();
  const callArray = Array<number>(10).fill(0);
  const ansArray = Array<number>(10).fill(0);
  for (let i = 0; i < call.length; i++) {
    callArray[call[i]]++;
    ansArray[answer[i]]++;
  }
  for (let i = 0; i < 10; i++) {
    if (Math.min(callArray[i], ansArray[i]) >= 1) {
      blows.add(i);
    }
  }
  return blows;
};

const generateHistoryString = ({
  call,
  hitsCount,
  blowsCount,
}: HitAndBlowHistory) => {
  return `${call
    .map((dig: number) => String(dig))
    .join('')}: ${hitsCount} Hit ${blowsCount} Blow`;
};

const answerLength2TimeLimit = (answerLength: number) => {
  return answerLength * 3 * 60 * 1000;
};

class HitAndBlowBot extends ChannelLimitedBot {
  protected override readonly wakeWordRegex = /^hitandblow( \d+)?$/;
  protected override readonly username = 'Hit & Blow';
  protected override readonly iconEmoji = '1234';

  private state = new HitAndBlowState();

  constructor(slackClients: SlackInterface) {
    super(slackClients);
  }

  // call履歴をpostする関数
  private async postHistory(history: HitAndBlowHistory[]) {
    if (history.length === 0) {
      await this.postMessage({
        text: 'コール履歴: なし',
        channel: this.state.channel, // これが呼び出される時点ではchannelはnullにならないはず
        thread_ts: this.state.thread,
      });
    } else {
      await this.postMessage({
        text: stripIndent`
      コール履歴: \`\`\`${history
        .map((hist: HitAndBlowHistory) => generateHistoryString(hist))
        .join('\n')}\`\`\`
      `,
        channel: this.state.channel, // これが呼び出される時点ではchannelはnullにならないはず
        thread_ts: this.state.thread,
      });
    }
  }

  // タイムアップ処理
  private async timeUp() {
    await this.postMessage({
      text: '～～～～～～～～～～おわり～～～～～～～～～～',
      channel: this.state.channel, // これが呼び出される時点ではchannelはnullにならないはず
      thread_ts: this.state.thread,
    });
    await this.postMessage({
      text: stripIndent`
          正解者は出ませんでした:sob:
          答えは \`${this.state.answer
            .map((dig: number) => String(dig))
            .join('')}\` だよ:cry:`,
      channel: this.state.channel, // これが呼び出される時点ではchannelはnullにならないはず
      thread_ts: this.state.thread,
      reply_broadcast: true,
    });
    await this.postHistory(this.state.history);

    await this.deleteProgressMessage(this.state.thread);

    // 終了処理
    this.state.clear();
  }

  protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
    const gameMessageDeferred = new Deferred<string | null>();

    (async () => {
      if (this.state.inGame) {
        const ongoingUrl = `https://tsg.slack.com/archives/${
          this.state.channel
        }/p${this.state.thread.replace('.', '')}`;
        await this.postMessage({
          text: `<${ongoingUrl}|進行中のゲーム>があるよ:thinking_face:`,
          channel,
        });
        gameMessageDeferred.resolve(null);
        return;
      }

      const rawAnswerLength = message.text.match(/^hitandblow( \d+)?$/)?.[1];
      const answerLength =
        rawAnswerLength !== undefined ? parseInt(rawAnswerLength) : 4;
      if (answerLength <= 0 || 10 < answerLength) {
        await this.postMessage({
          text: '桁数は1以上10以下で指定してね:thinking_face:',
          channel,
        });
        gameMessageDeferred.resolve(null);
      } else {
        // state を更新してゲームを開始
        this.state.inGame = true;
        this.state.answer = shuffle(range(10)).slice(0, answerLength);
        this.state.channel = channel;
        const { ts } = await this.postMessage({
          text: stripIndent`
            Hit & Blow (${this.state.answer.length}桁) を開始します。
            スレッドに数字でコールしてね`,
          channel: this.state.channel,
        });
        this.state.thread = ts as string;
        this.state.startDate = Date.now();
        const timeLimit = answerLength2TimeLimit(answerLength);
        this.state.timer = setTimeout(() => this.timeUp(), timeLimit);
        await this.postMessage({
          text: `制限時間は${timeLimit / 1000 / 60}分です`,
          channel: this.state.channel,
          thread_ts: this.state.thread,
        });

        // 実績解除
        unlock(message.user, 'hitandblow-play');

        gameMessageDeferred.resolve(ts);
      }
    })().catch((error: unknown) => {
      this.log.error('Failed to start hitandblow game', error);
      const errorText =
        error instanceof Error && error.stack !== undefined
          ? error.stack : String(error);
      this.postMessage({
        channel,
        text: `エラー😢\n\`${errorText}\``,
      });
      gameMessageDeferred.resolve(null);
    });

    return gameMessageDeferred.promise;
  }

  protected override async onMessageEvent(event: MessageEvent) {
    await super.onMessageEvent(event);

    const message = extractMessage(event);

    if (
      message === null ||
      !message.text ||
      message.subtype
    ) {
      return;
    }

    if (!this.allowedChannels.includes(message.channel)) {
      return;
    }

    // ゲーム中のスレッドでのみ反応
    if (message.thread_ts === this.state.thread) {
      // call処理
      if (message.text.match(/^\d+$/)) {
        if (!this.state.inGame) {
          return;
        }
        const call = [...message.text].map((dig: string) => parseInt(dig));

        if (call.length !== this.state.answer.length) {
          await this.postMessage({
            text: `桁数が違うよ:thinking_face: (${this.state.answer.length}桁)`,
            channel: this.state.channel,
            thread_ts: this.state.thread,
          });
        } else {
          if (!isValidCall(call)) {
            await this.postMessage({
              text: 'コール中に同じ数字を2個以上含めることはできないよ:thinking_face:',
              channel: this.state.channel,
              thread_ts: this.state.thread,
            });
          } else {
            // validなcallの場合
            const hits = countHit(call, this.state.answer);
            const blows = countBlow(call, this.state.answer);
            this.state.history.push({
              call,
              hitsCount: hits.size,
              blowsCount: blows.size - hits.size,
            });

            await this.postMessage({
              text: `\`${call.map((dig: number) => String(dig)).join('')}\`: ${
                hits.size
              } Hit ${blows.size - hits.size} Blow`, // ここもgenerateHistoryStringとまとめようと思ったけど、ここ一箇所のために``用の分岐を入れるのもなんか違う気がしてる
              channel: this.state.channel,
              thread_ts: this.state.thread,
            });

            if (hits.size === this.state.answer.length) {
              const passedTime = Date.now() - this.state.startDate;
              await this.postMessage({
                text: stripIndent`
                <@${message.user}> 正解です:tada:
                答えは \`${this.state.answer
                  .map((dig: number) => String(dig))
                  .join('')}\` だよ:muscle:
                手数: ${this.state.history.length}手
                経過時間: ${round(passedTime / 1000, 3).toFixed(3)}秒`,
                channel: this.state.channel,
                thread_ts: this.state.thread,
                reply_broadcast: true,
              });
              await this.postHistory(this.state.history);

              // 実績解除
              await unlock(message.user, 'hitandblow-clear');
              if (this.state.answer.length >= 6) {
                await unlock(message.user, 'hitandblow-clear-6digits-or-more');
              }
              if (this.state.answer.length === 10) {
                await unlock(message.user, 'hitandblow-clear-10digits');
              }
              if (this.state.answer.length >= 3 && this.state.history.length === 1) {
                await unlock(
                  message.user,
                  'hitandblow-clear-once-3digits-or-more'
                );
              }
              if (this.state.answer.length === 10 && passedTime <= 5 * 60 * 1000) {
                await unlock(
                  message.user,
                  'hitandblow-clear-10digits-within-5min'
                );
              }

              await this.deleteProgressMessage(this.state.thread);

              // 終了処理
              this.state.clear();
            }
          }
        }
      }

      // ギブアップ処理
      /*
      if (message.text.match(/^(giveup|ギブアップ)$/)) {
        await this.postMessage({
          text: stripIndent`
          正解者は出ませんでした:sob:
          答えは \`${this.state.answer
            .map((dig: number) => String(dig))
            .join('')}\` だよ:cry:`,
          channel: process.env.CHANNEL_SANDBOX as string,
          thread_ts: this.state.thread,
          reply_broadcast: true,
        });
        await this.postHistory(this.state.history);

        // 終了処理
        this.state.clear();
      }
      */

      // history処理
      if (message.text.match(/^(history|コール履歴)$/)) {
        await this.postHistory(this.state.history);
      }
    }

    // 支援機能
    if (message.text.match(/^hbdiff \d+ \d+$/)) {
      const [, rawCall1, rawCall2] = message.text.match(/^hbdiff (\d+) (\d+)$/);
      const call1 = [...rawCall1].map((dig: string) => parseInt(dig));
      const call2 = [...rawCall2].map((dig: string) => parseInt(dig));
      if (call1.length !== call2.length) {
        await this.postMessage({
          text: `桁数が違うので比較できないよ:cry:`,
          channel: message.channel,
          thread_ts: message.ts,
        });
      } else {
        if (!isValidCall(call1) || !isValidCall(call2)) {
          await this.postMessage({
            text: 'どちらかのコール中に同じ数字が含まれているよ:cry:',
            channel: message.channel,
            thread_ts: message.ts,
          });
        } else {
          const hits = countHit(call1, call2);
          const blows = countBlow(call1, call2);
          await this.postMessage({
            text: stripIndent`
            >>>${call1
              .map((dig) => {
                if (hits.has(dig)) {
                  return `*${dig}*`;
                } else if (blows.has(dig)) {
                  return `_${dig}_`;
                } else {
                  return `~${dig}~`;
                }
              })
              .join(' ')}
            ${call2
              .map((dig) => {
                if (hits.has(dig)) {
                  return `*${dig}*`;
                } else if (blows.has(dig)) {
                  return `_${dig}_`;
                } else {
                  return `~${dig}~`;
                }
              })
              .join(' ')}
            `,
            channel: message.channel,
            thread_ts: message.ts,
          });
        }
      }
    }
  }
}

export default function hitandblow(slackClients: SlackInterface) {
  return new HitAndBlowBot(slackClients);
}
