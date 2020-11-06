import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import { range, shuffle } from 'lodash';
import { stripIndent } from 'common-tags';
import leven from 'leven';
import { unlock } from '../achievements';
import achievements, { Difficulty } from '../achievements/achievements';
import assert from 'assert';

class AchievementQuizState {
  answer: number[] = [];
  thread?: string = undefined;
  inGame: boolean = false;
  clear() {
    this.answer = [];
    this.thread = undefined;
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
  rtm.on('message', async message => {});
};
