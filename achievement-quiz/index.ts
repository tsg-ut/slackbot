import { AteQuizProblem, AteQuiz } from '../atequiz';
import { SlackInterface } from '../lib/slack';
import { ChatPostMessageArguments } from '@slack/web-api';
import { stripIndent, source } from 'common-tags';
import { sample } from 'lodash';
import { increment, unlock } from '../achievements';
import achievementsMap, {
  Achievement,
  Difficulty,
} from '../achievements/achievements';

const timeLimitSec = 2 * 60;

interface AchievementAteQuizProblem extends AteQuizProblem {
  correctAchievement: Achievement;
  titleHided: string;
}

class AchievementAteQuiz extends AteQuiz {
  // ヒントはない
  waitSecGen(): number {
    return timeLimitSec;
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

const generateProblem = (answer: Achievement): AchievementAteQuizProblem => {
  const channel = process.env.CHANNEL_SANDBOX;
  const titleHided =
    answer.title[0] +
    Array.from(answer.title.slice(1))
      .map(char => {
        if (char.match(/^[\p{Letter}\p{Number}]$/u)) {
          return '_';
        } else {
          return char;
        }
      })
      .join('');

  const problemMessage: ChatPostMessageArguments = {
    channel,
    text: `この実績なーんだ\n【${titleHided}】（${
      answer.title.length
    }文字）\n>*解除条件*: ${
      answer.condition
    }\n>*解除難易度*: ${difficultyToStars(answer.difficulty)} (${
      answer.difficulty
    })\n解答はスレッドへ`,
  };

  const immediateMessage = {
    channel,
    text: `制限時間は2分です。解答の雛形↓\n${titleHided}`,
  };

  const solvedMessage = {
    channel,
    text: `<@[[!user]]> 正解です:clap:\n答えは *<https://achievements.tsg.ne.jp/achievements/${answer.id}|${answer.title}>* だよ:laughing:`,
    reply_broadcast: true,
  };

  const unsolvedMessage = {
    channel,
    text: `正解者は出ませんでした:sob:\n答えは *<https://achievements.tsg.ne.jp/achievements/${answer.id}|${answer.title}>* だよ:cry:`,
    reply_broadcast: true,
  };

  const correctAnswers = [answer.title];

  const problem = {
    problemMessage,
    hintMessages: [],
    immediateMessage,
    solvedMessage,
    unsolvedMessage,
    answerMessage: null,
    correctAnswers,
    correctAchievement: answer,
    titleHided,
  } as AchievementAteQuizProblem;

  return problem;
};

const postOption = {
  username: '実績当てクイズ',
  icon_emoji: ':achievement:',
};

const achievements = Array.from(achievementsMap.values());

export default (slackClients: SlackInterface): void => {
  const { eventClient } = slackClients;
  console.log('debug');

  eventClient.on('message', async message => {
    console.log('debug');
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
    if (message.text.match(/^実績当てクイズ$/)) {
      const randomAchievement = sample(achievements);
      const problem = generateProblem(randomAchievement);
      const quiz = new AchievementAteQuiz(slackClients, problem, postOption);
      const result = await quiz.start();

      // 実績解除
      if (result.state === 'solved') {
        increment(result.correctAnswerer, 'achievement-quiz-clear');
        unlock(
          result.correctAnswerer,
          `achievement-quiz-clear-${problem.correctAchievement.difficulty}`
        );
        if (
          problem.correctAchievement.id ===
          'achievement-quiz-clear-this-achievement'
        ) {
          unlock(
            result.correctAnswerer,
            'achievement-quiz-clear-this-achievement'
          );
        }
      }
    }
  });
};
