import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import { range, shuffle } from 'lodash';
import { stripIndent } from 'common-tags';
import leven from 'leven';
import { unlock } from '../achievements';
import achievements, { Difficulty } from '../achievements/achievements';
import assert from 'assert';

// ゲームの状態を保持する変数のクラス
// スレッド内のみ解答可能の場合は、thread_tsを保持するメンバも持つ
class AchievementQuizState {
  answer: number[] = [];
  inGame: boolean = false;
  clear() {
    this.answer = [];
    this.inGame = false;
    return;
  }
}

export default ({
  rtmClient: rtm,
  webClient: slack,
}: {
  rtmClient: RTMClient;
  webClient: WebClient;
}) => {
  const state = new AchievementQuizState();

  rtm.on('message', async message => {
    // sandboxでのみ
    if (message.channel !== process.env.CHANNEL_SANDBOX) {
      return;
    }
    // botを弾く
    if (
      message.subtype === 'bot_message' ||
      message.subtype === 'slackbot_response'
    ) {
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
        // 今回はただスルー
        return;

        // スレッド解答式の場合は、進行中のスレッド内でreply_broadcastをtrueにして通知すると良い
        // （進行中のスレッドを探すのは、一般的にめんどくさいため）
        /*
        await slack.chat.postMessage({
          text: '進行中のゲームがあるよ:thinking_face:',
          channel: process.env.CHANNEL_SANDBOX as string,
          username: '実績当てクイズ',
          icon_emoji: 'achievement',
          thread_ts: state.thread,
          reply_broadcast: true,
        });
        */
      }
    }
  });
};
