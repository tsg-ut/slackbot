import { AteQuizProblem, AteQuiz } from '../atequiz';
import { SlackInterface } from '../lib/slack';
import { ChatPostMessageArguments, GenericMessageEvent } from '@slack/web-api';
import { sample } from 'lodash-es';
import { increment, unlock } from '../achievements';
import achievementsMap, {
  Achievement,
  Difficulty,
} from '../achievements/achievements';
import { ChannelLimitedBot } from '../lib/channelLimitedBot';
import { Deferred } from '../lib/utils';

const timeLimitSec = 2 * 60;

interface AchievementAteQuizProblem extends AteQuizProblem {
  correctAchievement: Achievement;
  titleHided: string;
}

class AchievementAteQuiz extends AteQuiz {
  // 雛形postをヒント扱いに
  waitSecGen(hintIndex: number): number {
    return hintIndex === 0 ? 0 : timeLimitSec;
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

const generateProblem = (
  answer: Achievement,
  channel: string
): AchievementAteQuizProblem => {
  const titleHided =
    answer.title[0] +
    Array.from(answer.title.slice(1))
      .map((char) => {
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

  const hintMessages = [
    {
      channel,
      text: titleHided,
    },
  ];

  const immediateMessage = {
    channel,
    text: `制限時間は2分です。解答の雛形↓`,
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
    hintMessages,
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

const achievements = Array.from(achievementsMap.values());

class AchievementQuizBot extends ChannelLimitedBot {
  protected override readonly wakeWordRegex = /^実績当てクイズ$/;

  protected override readonly username = '実績当てクイズ';

  protected override readonly iconEmoji = ':achievement:';

  protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
    const quizMessageDeferred = new Deferred<string | null>();

    (async () => {
      const randomAchievement = sample(achievements);
      const problem = generateProblem(
        randomAchievement,
        channel
      );
      const quiz = new AchievementAteQuiz(this.slackClients, problem, {
        username: this.username,
        icon_emoji: this.iconEmoji,
      });

      const result = await quiz.start({
        mode: 'normal',
        onStarted(startMessage) {
          quizMessageDeferred.resolve(startMessage.ts!);
        },
      });

      await this.deleteProgressMessage(await quizMessageDeferred.promise);

      // 実績解除
      if (result.state === 'solved') {
        increment(result.correctAnswerer, 'achievement-quiz-clear');
        increment(
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
    })().catch((error: unknown) => {
      this.log.error('Failed to start achievement quiz', error);
      const errorText =
        error instanceof Error && error.stack !== undefined
          ? error.stack : String(error);
      this.postMessage({
        channel,
        text: `エラー😢\n\`${errorText}\``,
      });
      quizMessageDeferred.resolve(null);
    });

    return quizMessageDeferred.promise;
  }
}

// eslint-disable-next-line require-jsdoc
export default function achievementQuiz(slackClients: SlackInterface) {
  return new AchievementQuizBot(slackClients);
}
