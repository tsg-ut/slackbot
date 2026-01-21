"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AteQuiz = exports.typicalMessageTextsGenerator = exports.typicalAteQuizHintTexts = void 0;
const assert_1 = __importDefault(require("assert"));
const async_mutex_1 = require("async-mutex");
const utils_1 = require("../lib/utils");
exports.typicalAteQuizHintTexts = [
    'しょうがないにゃあ、ヒントだよ',
    'もう一つヒントだよ、早く答えてね',
    'まだわからないの？ヒント追加するからね',
    '最後のヒントだよ！もうわかるよね？',
];
/**
 * Generator functions for typical quiz messages.
 * In default, a subtext '[[!user]]' automatically replaced with the message.user in solvedMessage.
 */
exports.typicalMessageTextsGenerator = {
    problem: (genre) => `この${genre}なーんだ`,
    immediate: () => '15秒経過でヒントを出すよ♫',
    solved: (answer) => `<@[[!user]]> 正解:tada:\n答えは${answer}だよ:muscle:`,
    unsolved: (answer) => `もう、しっかりして！\n答えは${answer}だよ:anger:`,
};
/**
 * A Class for XX当てクイズ for #sandbox.
 * Channels of hints must be same as problem channel. thread_ts will be ignored.
 * To use other judge/watSecGen/ngReaction, please extend this class.
 */
class AteQuiz {
    eventClient;
    slack;
    problem;
    ngReaction = 'no_good';
    state = 'waiting';
    replaceKeys = { correctAnswerer: '[[!user]]' };
    mutex;
    postOption;
    threadTsDeferred = new utils_1.Deferred();
    judge(answer, _user) {
        return this.problem.correctAnswers.some((correctAnswer) => answer === correctAnswer);
    }
    waitSecGen(hintIndex) {
        return hintIndex === this.problem.hintMessages.length ? 30 : 15;
    }
    /**
     * Generate solved message.
     * @param {any} post the post judged as correct
     * @returns a object that specifies the parameters of a solved message
     */
    solvedMessageGen(post) {
        const message = Object.assign({}, this.problem.solvedMessage);
        message.text = message.text.replaceAll(this.replaceKeys.correctAnswerer, 'user' in post ? post.user : '');
        return message;
    }
    answerMessageGen(_post) {
        if (!this.problem.answerMessage) {
            return null;
        }
        return this.problem.answerMessage;
    }
    incorrectMessageGen(post) {
        if (!this.problem.incorrectMessage) {
            return null;
        }
        const message = Object.assign({}, this.problem.incorrectMessage);
        message.text = message.text.replaceAll(this.replaceKeys.correctAnswerer, 'user' in post ? post.user : '');
        return message;
    }
    constructor({ eventClient, webClient: slack }, problem, option) {
        this.eventClient = eventClient;
        this.slack = slack;
        this.problem = problem;
        this.postOption = option ? JSON.parse(JSON.stringify(option)) : option;
        (0, assert_1.default)(this.problem.hintMessages.every((hint) => hint.channel === this.problem.problemMessage.channel));
        this.mutex = new async_mutex_1.Mutex();
    }
    async repostProblemMessage() {
        const threadTs = await this.threadTsDeferred.promise;
        return this.slack.chat.postMessage({
            ...Object.assign({}, this.problem.problemMessage, this.postOption),
            thread_ts: threadTs,
            reply_broadcast: true,
        });
    }
    /**
     * Start AteQuiz.
     * @returns A promise of AteQuizResult that becomes resolved when the quiz ends.
     */
    async start(startOption) {
        const _option = Object.assign({ mode: 'normal' }, startOption);
        this.state = 'solving';
        const postMessage = (message) => {
            const toSend = Object.assign({}, message, this.postOption);
            return this.slack.chat.postMessage(toSend);
        };
        const result = {
            quiz: this.problem,
            state: 'unsolved',
            correctAnswerer: null,
            hintIndex: null,
        };
        let previousHintTime = null;
        let hintIndex = 0;
        const deferred = new utils_1.Deferred();
        const onTick = () => {
            this.mutex.runExclusive(async () => {
                const now = Date.now();
                const nextHintTime = previousHintTime + 1000 * this.waitSecGen(hintIndex);
                if (this.state === 'solving' && nextHintTime <= now) {
                    previousHintTime = now;
                    if (hintIndex < this.problem.hintMessages.length) {
                        const hint = this.problem.hintMessages[hintIndex];
                        await postMessage(Object.assign({}, hint, { thread_ts }));
                        hintIndex++;
                    }
                    else {
                        this.state = 'unsolved';
                        await postMessage(Object.assign({}, this.problem.unsolvedMessage, { thread_ts, reply_broadcast: true }));
                        const answerMessage = await this.answerMessageGen();
                        if (answerMessage) {
                            await postMessage(Object.assign({}, answerMessage, { thread_ts }));
                        }
                        clearInterval(tickTimer);
                        deferred.resolve(result);
                    }
                }
            });
        };
        this.eventClient.on('message', async (message) => {
            const thread_ts = await this.threadTsDeferred.promise;
            if ('thread_ts' in message && message.thread_ts === thread_ts) {
                if (message.subtype === 'bot_message')
                    return;
                if (_option.mode === 'solo' && message.user !== _option.player)
                    return;
                this.mutex.runExclusive(async () => {
                    if (this.state === 'solving') {
                        const answer = message.text;
                        const isCorrect = await this.judge(answer, message.user);
                        if (isCorrect) {
                            this.state = 'solved';
                            clearInterval(tickTimer);
                            await postMessage(Object.assign({}, await this.solvedMessageGen(message), { thread_ts, reply_broadcast: true }));
                            const answerMessage = await this.answerMessageGen(message);
                            if (answerMessage) {
                                await postMessage(Object.assign({}, answerMessage, { thread_ts }));
                            }
                            result.correctAnswerer = message.user;
                            result.hintIndex = hintIndex;
                            result.state = 'solved';
                            deferred.resolve(result);
                        }
                        else {
                            const generatedMessage = this.incorrectMessageGen(message);
                            if (this.ngReaction) {
                                this.slack.reactions.add({
                                    name: this.ngReaction,
                                    channel: message.channel,
                                    timestamp: message.ts,
                                });
                            }
                            if (generatedMessage) {
                                await postMessage(Object.assign({}, generatedMessage, { thread_ts }));
                            }
                        }
                    }
                });
            }
        });
        // Listeners should be added before postMessage is called.
        const response = await postMessage(this.problem.problemMessage);
        if (startOption?.onStarted) {
            startOption.onStarted(response);
        }
        const thread_ts = response?.message?.thread_ts ?? response.ts;
        this.threadTsDeferred.resolve(thread_ts);
        (0, assert_1.default)(typeof thread_ts === 'string');
        if (this.problem.immediateMessage) {
            await postMessage(Object.assign({}, this.problem.immediateMessage, { thread_ts }));
        }
        previousHintTime = Date.now();
        const tickTimer = setInterval(onTick, 1000);
        return deferred.promise;
    }
}
exports.AteQuiz = AteQuiz;
