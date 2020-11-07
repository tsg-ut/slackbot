import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import { range, shuffle, round } from 'lodash';
import { stripIndent } from 'common-tags';
import { unlock } from '../achievements';
import assert from 'assert';

interface HitAndBlowHistory {
  call: number[];
  hitsCount: number;
  blowsCount: number;
}

class HitAndBlowState {
  answer: number[] = [];
  history: HitAndBlowHistory[] = [];
  thread?: string = null;
  startDate?: number = null;
  inGame: boolean = false;
  clear() {
    this.answer = [];
    this.history = [];
    this.thread = null;
    this.startDate = null;
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

export default ({
  rtmClient: rtm,
  webClient: slack,
}: {
  rtmClient: RTMClient;
  webClient: WebClient;
}) => {
  const state = new HitAndBlowState();

  // call履歴をpostする関数
  const postHistory = async (history: HitAndBlowHistory[]) => {
    if (history.length === 0) {
      await slack.chat.postMessage({
        text: 'コール履歴: なし',
        channel: process.env.CHANNEL_SANDBOX as string,
        username: 'Hit & Blow',
        icon_emoji: '1234',
        thread_ts: state.thread,
      });
    } else {
      await slack.chat.postMessage({
        text: stripIndent`
      コール履歴: \`\`\`${history
        .map((hist: HitAndBlowHistory) => generateHistoryString(hist))
        .join('\n')}\`\`\`
      `,
        channel: process.env.CHANNEL_SANDBOX as string,
        username: 'Hit & Blow',
        icon_emoji: '1234',
        thread_ts: state.thread,
      });
    }
  };

  // タイムアップ処理
  const timeUp = async () => {
    await slack.chat.postMessage({
      text: '～～～～～～～～～～おわり～～～～～～～～～～',
      channel: process.env.CHANNEL_SANDBOX as string,
      username: 'Hit & Blow',
      icon_emoji: '1234',
      thread_ts: state.thread,
    });
    await slack.chat.postMessage({
      text: stripIndent`
          正解者は出ませんでした:sob:
          答えは \`${state.answer
            .map((dig: number) => String(dig))
            .join('')}\` だよ:cry:`,
      channel: process.env.CHANNEL_SANDBOX as string,
      username: 'Hit & Blow',
      icon_emoji: '1234',
      thread_ts: state.thread,
      reply_broadcast: true,
    });
    postHistory(state.history);

    // 終了処理
    state.clear();
  };

  rtm.on('message', async message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX) {
      return;
    }
    if (
      message.subtype === 'bot_message' ||
      message.subtype === 'slackbot_response'
    ) {
      return;
    }
    if (!message.text) {
      return;
    }

    // game開始処理
    if (message.text.match(/^hitandblowa( \d+)?$/)) {
      if (state.inGame) {
        await slack.chat.postMessage({
          text: '進行中のゲームがあるよ:thinking_face:',
          channel: process.env.CHANNEL_SANDBOX as string,
          username: 'Hit & Blow',
          icon_emoji: '1234',
          thread_ts: state.thread,
          reply_broadcast: true,
        });
        return;
      } else {
        const rawAnswerLength = message.text.match(/^hitandblowa( \d+)?$/)[1];
        const answerLength =
          rawAnswerLength !== undefined ? parseInt(rawAnswerLength) : 4;
        if (answerLength <= 0 || 10 < answerLength) {
          await slack.chat.postMessage({
            text: '桁数は1以上10以下で指定してね:thinking_face:',
            channel: process.env.CHANNEL_SANDBOX as string,
            username: 'Hit & Blow',
            icon_emoji: '1234',
          });
        } else {
          state.inGame = true;
          state.answer = shuffle(range(10)).slice(0, answerLength);
          const { ts } = await slack.chat.postMessage({
            text: stripIndent`
            Hit & Blow (${state.answer.length}桁) を開始します。
            スレッドに数字でコールしてね`,
            channel: process.env.CHANNEL_SANDBOX as string,
            username: 'Hit & Blow',
            icon_emoji: '1234',
          });
          state.thread = ts as string;
          state.startDate = Date.now();
          const timeLimit = answerLength2TimeLimit(answerLength);
          setTimeout(timeUp, timeLimit);
          await slack.chat.postMessage({
            text: `制限時間は${timeLimit / 1000 / 60}分です`,
            channel: process.env.CHANNEL_SANDBOX as string,
            username: 'Hit & Blow',
            icon_emoji: '1234',
            thread_ts: state.thread,
          });

          // 実績解除
          unlock(message.user, 'hitandblow-play');
        }
      }
    }

    // ゲーム中のスレッドでのみ反応
    if (message.thread_ts === state.thread) {
      // call処理
      if (message.text.match(/^\d+$/)) {
        if (!state.inGame) {
          return;
        }
        const call = [...message.text].map((dig: string) => parseInt(dig));

        if (call.length !== state.answer.length) {
          await slack.chat.postMessage({
            text: `桁数が違うよ:thinking_face: (${state.answer.length}桁)`,
            channel: process.env.CHANNEL_SANDBOX as string,
            username: 'Hit & Blow',
            icon_emoji: '1234',
            thread_ts: state.thread,
          });
        } else {
          if (!isValidCall(call)) {
            await slack.chat.postMessage({
              text:
                'コール中に同じ数字を2個以上含めることはできないよ:thinking_face:',
              channel: process.env.CHANNEL_SANDBOX as string,
              username: 'Hit & Blow',
              icon_emoji: '1234',
              thread_ts: state.thread,
            });
          } else {
            // validなcallの場合
            const hits = countHit(call, state.answer);
            const blows = countBlow(call, state.answer);
            state.history.push({
              call,
              hitsCount: hits.size,
              blowsCount: blows.size - hits.size,
            });

            await slack.chat.postMessage({
              text: `\`${call.map((dig: number) => String(dig)).join('')}\`: ${
                hits.size
              } Hit ${blows.size - hits.size} Blow`, // ここもgenerateHistoryStringとまとめようと思ったけど、ここ一箇所のために``用の分岐を入れるのもなんか違う気がしてる
              channel: process.env.CHANNEL_SANDBOX as string,
              username: 'Hit & Blow',
              icon_emoji: '1234',
              thread_ts: state.thread,
            });

            if (hits.size === state.answer.length) {
              const passedTime = Date.now() - state.startDate;
              await slack.chat.postMessage({
                text: stripIndent`
                <@${message.user}> 正解です:tada:
                答えは \`${state.answer
                  .map((dig: number) => String(dig))
                  .join('')}\` だよ:muscle:
                経過時間: ${round(passedTime / 1000, 2).toFixed(2)}秒`,
                channel: process.env.CHANNEL_SANDBOX as string,
                username: 'Hit & Blow',
                icon_emoji: '1234',
                thread_ts: state.thread,
                reply_broadcast: true,
              });
              postHistory(state.history);

              // 実績解除
              await unlock(message.user, 'hitandblow-clear');
              if (state.answer.length >= 6) {
                await unlock(message.user, 'hitandblow-clear-6digits-or-more');
              }
              if (state.answer.length === 10) {
                await unlock(message.user, 'hitandblow-clear-10digits');
              }
              if (state.answer.length >= 3 && state.history.length === 1) {
                await unlock(
                  message.user,
                  'hitandblow-clear-once-3digits-or-more'
                );
              }
              if (state.answer.length === 10 && passedTime <= 5 * 60 * 1000) {
                await unlock(
                  message.user,
                  'hitandblow-clear-10digits-within-5min'
                );
              }

              // 終了処理
              state.clear();
            }
          }
        }
      }

      // ギブアップ処理
      /*
      if (message.text.match(/^(giveup|ギブアップ)$/)) {
        await slack.chat.postMessage({
          text: stripIndent`
          正解者は出ませんでした:sob:
          答えは \`${state.answer
            .map((dig: number) => String(dig))
            .join('')}\` だよ:cry:`,
          channel: process.env.CHANNEL_SANDBOX as string,
          username: 'Hit & Blow',
          icon_emoji: '1234',
          thread_ts: state.thread,
          reply_broadcast: true,
        });
        postHistory(state.history);

        // 終了処理
        state.clear();
      }
      */

      // history処理
      if (message.text.match(/^(history|コール履歴)$/)) {
        postHistory(state.history);
      }
    }

    // 支援機能
    if (message.text.match(/^hbdiff \d+ \d+$/)) {
      const [, rawCall1, rawCall2] = message.text.match(/^hbdiff (\d+) (\d+)$/);
      const call1 = [...rawCall1].map((dig: string) => parseInt(dig));
      const call2 = [...rawCall2].map((dig: string) => parseInt(dig));
      if (call1.length !== call2.length) {
        await slack.chat.postMessage({
          text: `桁数が違うので比較できないよ:cry:`,
          channel: process.env.CHANNEL_SANDBOX as string,
          username: 'Hit & Blow',
          icon_emoji: '1234',
          thread_ts: message.ts,
        });
      } else {
        if (!isValidCall(call1) || !isValidCall(call2)) {
          await slack.chat.postMessage({
            text: 'どちらかのコール中に同じ数字が含まれているよ:cry:',
            channel: process.env.CHANNEL_SANDBOX as string,
            username: 'Hit & Blow',
            icon_emoji: '1234',
            thread_ts: message.ts,
          });
        } else {
          const hits = countHit(call1, call2);
          const blows = countBlow(call1, call2);
          await slack.chat.postMessage({
            text: stripIndent`
            >>>${call1
              .map(dig => {
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
              .map(dig => {
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
            channel: process.env.CHANNEL_SANDBOX as string,
            username: 'Hit & Blow',
            icon_emoji: '1234',
            thread_ts: message.ts,
          });
        }
      }
    }
  });
};
