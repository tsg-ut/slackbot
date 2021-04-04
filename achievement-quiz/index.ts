import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import { random } from 'lodash';
import { stripIndent, source } from 'common-tags';
import leven from 'leven';
import { unlock } from '../achievements';
import achievementsMap, {
  Achievement,
  Difficulty,
} from '../achievements/achievements';
import assert from 'assert';

// ゲームの状態を保持する変数のクラス
// スレッド内のみ解答可能の場合は、thread_tsを保持するメンバも持つ
class AchievementQuizState {
  answer: Achievement | null = null;
  thread: string | null = null;
  timer: NodeJS.Timeout | null = null;
  inGame: boolean = false;
  clear() {
    this.answer = null;
    this.thread = null;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = null;
    this.inGame = false;
    return;
  }
}

const difficultyToStars = (difficulty: Difficulty) =>
  ({
    baby: '★☆☆☆☆',
    easy: '★★☆☆☆',
    medium: '★★★☆☆',
    hard: '★★★★☆',
    professional: '★★★★★',
  }[difficulty]);

export default ({
  rtmClient: rtm,
  webClient: slack,
}: {
  rtmClient: RTMClient;
  webClient: WebClient;
}) => {
  const state = new AchievementQuizState();
  const achievements = Array.from(achievementsMap.values());

  // タイムアップ処理
  const timeUp = async () => {
    await slack.chat.postMessage({
      text: '～～～～～～～～～～おわり～～～～～～～～～～',
      channel: process.env.CHANNEL_SANDBOX as string,
      username: '実績当てクイズ',
      icon_emoji: 'achievement',
      thread_ts: state.thread,
    });
    await slack.chat.postMessage({
      text: stripIndent`
          正解者は出ませんでした:sob:
          答えは *<https://achievements.tsg.ne.jp/achievements/${state.answer.id}|${state.answer.title}>* だよ:cry:`,
      channel: process.env.CHANNEL_SANDBOX as string,
      username: '実績当てクイズ',
      icon_emoji: 'achievement',
      thread_ts: state.thread,
      reply_broadcast: true,
    });

    // 終了処理
    state.clear();
  };

  rtm.on('message', async message => {
    // sandboxでのみ
    if (message.channel !== process.env.CHANNEL_SANDBOX) {
      return;
    }
    // botを弾く
    if (message.bot_id) {
      return;
    }
    // undefined避け
    if (!message.text) {
      return;
    }

    // メッセージ内容が「実績当てクイズ」だった場合
    if (message.text.match(/^実績当てクイズ$/)) {
      // ゲーム進行中の場合
      if (state.inGame) {
        // 進行中のスレッド内でreply_broadcastをtrueにして通知
        // （進行中のスレッドを探すのは、一般的にめんどくさいため）
        await slack.chat.postMessage({
          text: '進行中のゲームがあるよ:thinking_face:',
          channel: process.env.CHANNEL_SANDBOX as string,
          username: '実績当てクイズ',
          icon_emoji: 'achievement',
          thread_ts: state.thread,
          reply_broadcast: true,
        });
      } else {
        state.inGame = true;
        state.answer = achievements[random(0, achievements.length - 1)];
        const { ts } = await slack.chat.postMessage({
          text: source`
          この実績なーんだ（解答はスレッドへ）
          >>>*解除条件*: ${state.answer.condition}
          *解除難易度*: ${difficultyToStars(state.answer.difficulty)} (${
            state.answer.difficulty
          })`,
          channel: process.env.CHANNEL_SANDBOX as string,
          username: '実績当てクイズ',
          icon_emoji: 'achievement',
        });

        state.thread = ts as string;
        state.timer = setTimeout(timeUp, 2 * 60 * 1000);
        await slack.chat.postMessage({
          text: `制限時間は2分です`,
          channel: process.env.CHANNEL_SANDBOX as string,
          username: '実績当てクイズ',
          icon_emoji: 'achievement',
          thread_ts: state.thread,
        });
      }
    }

    // ゲーム中のスレッドでのみ反応
    if (message.thread_ts === state.thread) {
      if (
        leven(message.text, state.answer.title) <=
        state.answer.title.length / 3
      ) {
        // リアクション
        await slack.reactions.add({
          name: 'thumbsup',
          channel: message.channel,
          timestamp: message.ts,
        });

        // post
        await slack.chat.postMessage({
          text: stripIndent`
          <@${message.user}> 正解です:clap:
          答えは *<https://achievements.tsg.ne.jp/achievements/${state.answer.id}|${state.answer.title}>* だよ:laughing:`,
          channel: process.env.CHANNEL_SANDBOX as string,
          username: '実績当てクイズ',
          icon_emoji: 'achievement',
          thread_ts: state.thread,
          reply_broadcast: true,
        });

        // 終了処理
        state.clear();
      } else {
        // リアクション
        await slack.reactions.add({
          name: 'woman-gesturing-no',
          channel: message.channel,
          timestamp: message.ts,
        });
      }
    }
  });
};
