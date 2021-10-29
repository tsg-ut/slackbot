import { KirafanCard, kirafanTools, getKirafanCards } from './';
import { AteQuizProblem, AteQuizResult, AteQuiz } from '../atequiz';
import { SlackInterface } from '../lib/slack';
import sharp from 'sharp';
import axios from 'axios';
import { sample } from 'lodash';

interface KirafanAteQuizProblem extends AteQuizProblem {
  correctAnswerCard: KirafanCard;
}
class KirafanAteQuiz extends AteQuiz {}

const generateProblem = (card: KirafanCard): KirafanAteQuizProblem => {
  // TODO: generate a problem
  return {} as KirafanAteQuizProblem;
};

export default (slackClients: SlackInterface): void => {
  const { rtmClient: rtm, webClient: slack } = slackClients;

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

    // クイズ開始処理
    if (message.text.match(/^きらファン当てクイズ$/)) {
      const randomKirafanCard = sample(await getKirafanCards());
      const problem = generateProblem(randomKirafanCard);
      const quiz = new KirafanAteQuiz(slackClients, problem);
    }
  });
};
