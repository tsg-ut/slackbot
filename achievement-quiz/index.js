"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = achievementQuiz;
const atequiz_1 = require("../atequiz");
const lodash_1 = require("lodash");
const achievements_1 = require("../achievements");
const achievements_2 = __importDefault(require("../achievements/achievements"));
const channelLimitedBot_1 = require("../lib/channelLimitedBot");
const utils_1 = require("../lib/utils");
const timeLimitSec = 2 * 60;
class AchievementAteQuiz extends atequiz_1.AteQuiz {
    // 雛形postをヒント扱いに
    waitSecGen(hintIndex) {
        return hintIndex === 0 ? 0 : timeLimitSec;
    }
}
const difficultyToStars = (difficulty) => ({
    baby: '★☆☆☆☆',
    easy: '★★☆☆☆',
    medium: '★★★☆☆',
    hard: '★★★★☆',
    professional: '★★★★★',
}[difficulty]);
const generateProblem = (answer, channel) => {
    const titleHided = answer.title[0] +
        Array.from(answer.title.slice(1))
            .map((char) => {
            if (char.match(/^[\p{Letter}\p{Number}]$/u)) {
                return '_';
            }
            else {
                return char;
            }
        })
            .join('');
    const problemMessage = {
        channel,
        text: `この実績なーんだ\n【${titleHided}】（${answer.title.length}文字）\n>*解除条件*: ${answer.condition}\n>*解除難易度*: ${difficultyToStars(answer.difficulty)} (${answer.difficulty})\n解答はスレッドへ`,
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
    };
    return problem;
};
const achievements = Array.from(achievements_2.default.values());
class AchievementQuizBot extends channelLimitedBot_1.ChannelLimitedBot {
    wakeWordRegex = /^実績当てクイズ$/;
    username = '実績当てクイズ';
    iconEmoji = ':achievement:';
    onWakeWord(message, channel) {
        const quizMessageDeferred = new utils_1.Deferred();
        (async () => {
            const randomAchievement = (0, lodash_1.sample)(achievements);
            const problem = generateProblem(randomAchievement, channel);
            const quiz = new AchievementAteQuiz(this.slackClients, problem, {
                username: this.username,
                icon_emoji: this.iconEmoji,
            });
            const result = await quiz.start({
                mode: 'normal',
                onStarted(startMessage) {
                    quizMessageDeferred.resolve(startMessage.ts);
                },
            });
            await this.deleteProgressMessage(await quizMessageDeferred.promise);
            // 実績解除
            if (result.state === 'solved') {
                (0, achievements_1.increment)(result.correctAnswerer, 'achievement-quiz-clear');
                (0, achievements_1.increment)(result.correctAnswerer, `achievement-quiz-clear-${problem.correctAchievement.difficulty}`);
                if (problem.correctAchievement.id ===
                    'achievement-quiz-clear-this-achievement') {
                    (0, achievements_1.unlock)(result.correctAnswerer, 'achievement-quiz-clear-this-achievement');
                }
            }
        })().catch((error) => {
            this.log.error('Failed to start achievement quiz', error);
            const errorText = error instanceof Error && error.stack !== undefined
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
function achievementQuiz(slackClients) {
    return new AchievementQuizBot(slackClients);
}
