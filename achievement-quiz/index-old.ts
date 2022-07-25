import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import { random } from 'lodash';
import { stripIndent, source } from 'common-tags';
import { increment, unlock } from '../achievements';
import achievementsMap, {
  Achievement,
  Difficulty,
} from '../achievements/achievements';

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

  const postMessage = async (text: string, thread_ts?: string, reply_broadcast: boolean = false) => {
    return await slack.chat.postMessage({
      text,
      channel: process.env.CHANNEL_SANDBOX as string,
      username: '実績当てクイズ',
      icon_emoji: 'achievement',
      thread_ts,
      reply_broadcast,
    })
  }

  // タイムアップ処理
  const timeUp = async () => {
    await postMessage('～～～～～～～～～～おわり～～～～～～～～～～', state.thread)
    await postMessage(stripIndent`
    正解者は出ませんでした:sob:
    答えは *<https://achievements.tsg.ne.jp/achievements/${state.answer.id}|${state.answer.title}>* だよ:cry:`,
    state.thread, true);

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
        await postMessage('進行中のゲームがあるよ:thinking_face:', state.thread, true)

      } else {
        state.inGame = true;
        state.answer = achievements[random(0, achievements.length - 1)];
        const titleHided = state.answer.title[0] + Array.from(state.answer.title.slice(1)).map(char => {
          if (char.match(/^[\p{Letter}\p{Number}]$/u)) {
            return '_';
          }
          else {
            return char;
          }
        }).join('')
        const { ts } = await postMessage(
          source`
          【${titleHided}】（${state.answer.title.length}文字）
          >*解除条件*: ${state.answer.condition}
          >*解除難易度*: ${difficultyToStars(state.answer.difficulty)} (${
            state.answer.difficulty
          })
          解答はスレッドへ
          `);

        state.thread = ts as string;
        state.timer = setTimeout(timeUp, 2 * 60 * 1000);
        await postMessage('制限時間は2分です。\n雛形↓', state.thread);
        await postMessage(titleHided, state.thread)
      }
    }

    // ゲーム中のスレッドでのみ反応
    if (message.thread_ts === state.thread) {
      if (message.text === state.answer.title) {
        // 終了処理
        const {answer, thread} = state;
        state.clear();

        // リアクション
        await slack.reactions.add({
          name: 'thumbsup',
          channel: message.channel,
          timestamp: message.ts,
        });

        // post
        await postMessage(
          stripIndent`
          <@${message.user}> 正解です:clap:
          答えは *<https://achievements.tsg.ne.jp/achievements/${answer.id}|${answer.title}>* だよ:laughing:`,
          thread, true);
        
        // 実績解除
        increment(message.user, 'achievement-quiz-clear')
        unlock(message.user, `achievement-quiz-clear-${answer.difficulty}`)
        if (answer.id === 'achievement-quiz-clear-this-achievement') {
          unlock(message.user, 'achievement-quiz-clear-this-achievement')
        }
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
