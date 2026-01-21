"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.SlowQuiz = exports.validateQuestion = void 0;
const buffer_1 = require("buffer");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
// @ts-expect-error: Not typed
const japanese_1 = require("japanese");
const js_yaml_1 = __importDefault(require("js-yaml"));
const lodash_1 = require("lodash");
const node_schedule_1 = require("node-schedule");
const achievements_1 = require("../achievements");
const logger_1 = __importDefault(require("../lib/logger"));
const openai_1 = __importStar(require("../lib/openai"));
const state_1 = __importDefault(require("../lib/state"));
const utils_1 = require("../lib/utils");
const util_1 = require("./util");
const answerQuestionDialog_1 = __importDefault(require("./views/answerQuestionDialog"));
const footer_1 = __importDefault(require("./views/footer"));
const gameDetailsDialog_1 = __importDefault(require("./views/gameDetailsDialog"));
const listQuizDialog_1 = __importDefault(require("./views/listQuizDialog"));
const postCommentDialog_1 = __importDefault(require("./views/postCommentDialog"));
const registerQuizDialog_1 = __importDefault(require("./views/registerQuizDialog"));
const mutex = new async_mutex_1.Mutex();
const getGenreText = (genre) => {
    if (genre === 'strange') {
        return '変化球';
    }
    if (genre === 'normal') {
        return '正統派';
    }
    return 'なんでも';
};
const validateQuestion = (question) => {
    if (question.split('/').length >= 5) {
        return question.split('/').length <= 90;
    }
    const normalizedQuestion = question.replaceAll(/【.*?】/g, '');
    return Array.from(normalizedQuestion).length <= 90;
};
exports.validateQuestion = validateQuestion;
const promptLoader = new utils_1.Loader(async () => {
    const promptYaml = await (0, promises_1.readFile)(path_1.default.join(__dirname, 'prompt.yml'));
    const prompt = js_yaml_1.default.load(promptYaml.toString());
    return prompt;
});
const reasoningPromptLoader = new utils_1.Loader(async () => {
    const promptYaml = await (0, promises_1.readFile)(path_1.default.join(__dirname, 'prompt-reasoning.yml'));
    const prompt = js_yaml_1.default.load(promptYaml.toString());
    return prompt;
});
const log = logger_1.default.child({ bot: 'slow-quiz' });
class SlowQuiz {
    #slack;
    #slackInteractions;
    #state;
    #MAX_CORRECT_ANSWERS = 3;
    #MAX_O4_MINI_OUTPUT_TOKENS = 3000;
    constructor({ slack, slackInteractions, }) {
        this.#slack = slack;
        this.#slackInteractions = slackInteractions;
    }
    async initialize() {
        this.#state = await state_1.default.init('slow-quiz', {
            games: [],
            latestStatusMessages: [],
            batchJobs: [],
        });
        this.#slackInteractions.action({
            type: 'button',
            actionId: 'slowquiz_register_quiz_button',
        }, (payload) => {
            mutex.runExclusive(() => (this.#showRegisterQuizDialog({
                triggerId: payload?.trigger_id,
            })));
        });
        this.#slackInteractions.viewSubmission('slowquiz_register_quiz_dialog', (payload) => {
            const stateObjects = Object.values(payload?.view?.state?.values ?? {});
            const state = Object.assign({}, ...stateObjects);
            mutex.runExclusive(() => (this.#registerQuiz({
                question: state?.question?.value,
                answer: state?.answer?.value,
                ruby: state?.ruby?.value,
                hint: state?.hint?.value,
                user: payload?.user?.id,
                genre: state?.genre?.selected_option?.value,
            })));
        });
        this.#slackInteractions.action({
            type: 'button',
            actionId: 'slowquiz_list_quiz_button',
        }, (payload) => {
            mutex.runExclusive(() => (this.#showListQuizDialog({
                triggerId: payload?.trigger_id,
                user: payload?.user?.id,
            })));
        });
        this.#slackInteractions.action({
            type: 'button',
            actionId: 'slowquiz_delete_quiz_button',
        }, (payload) => {
            const action = (payload?.actions ?? []).find((a) => (a.action_id === 'slowquiz_delete_quiz_button'));
            mutex.runExclusive(() => (this.#deleteQuiz({
                viewId: payload?.view?.id,
                id: action?.value,
                user: payload?.user?.id,
            })));
        });
        this.#slackInteractions.action({
            type: 'button',
            actionId: 'slowquiz_answer_question_button',
        }, (payload) => {
            mutex.runExclusive(() => (this.#showAnswerQuestionDialog({
                triggerId: payload.trigger_id,
                id: payload?.actions?.[0]?.value,
                user: payload?.user?.id,
                channel: payload?.channel?.id,
            })));
        });
        this.#slackInteractions.action({
            type: 'button',
            actionId: 'slowquiz_show_game_details_button',
        }, (payload) => {
            mutex.runExclusive(() => (this.#showGameDetailsDialog({
                triggerId: payload.trigger_id,
                id: payload?.actions?.[0]?.value,
                user: payload?.user?.id,
                channel: payload?.channel?.id,
            })));
        });
        this.#slackInteractions.viewSubmission('slowquiz_answer_question_dialog', (payload) => {
            const stateObjects = Object.values(payload?.view?.state?.values ?? {});
            const state = Object.assign({}, ...stateObjects);
            const id = payload?.view?.private_metadata;
            log.info({ state, id, payload });
            mutex.runExclusive(() => (this.#answerUserQuestion({
                id,
                ruby: state?.ruby?.value,
                comment: state?.slowquiz_answer_dialog_submit_comment?.value ?? null,
                user: payload.user.id,
            })));
        });
        this.#slackInteractions.action({
            type: 'plain_text_input',
            actionId: 'slowquiz_answer_dialog_submit_comment',
        }, (payload) => {
            const comment = payload?.actions?.[0]?.value ?? null;
            mutex.runExclusive(() => (this.#postComment({
                id: payload?.view?.private_metadata,
                viewId: payload?.view?.id,
                viewType: 'slowquiz_answer_dialog',
                comment,
                type: 'user',
                user: payload?.user?.id,
            })));
        });
        this.#slackInteractions.action({
            type: 'plain_text_input',
            actionId: 'slowquiz_post_comment_submit_comment',
        }, (payload) => {
            const comment = payload?.actions?.[0]?.value ?? null;
            mutex.runExclusive(() => (this.#postComment({
                id: payload?.view?.private_metadata,
                viewId: payload?.view?.id,
                viewType: 'slowquiz_post_comment_dialog',
                comment,
                type: 'user',
                user: payload?.user?.id,
            })));
        });
        this.#slackInteractions.viewSubmission('slowquiz_post_comment_dialog', (payload) => {
            const stateObjects = Object.values(payload?.view?.state?.values ?? {});
            const state = Object.assign({}, ...stateObjects);
            mutex.runExclusive(() => (this.#postComment({
                id: payload?.view?.private_metadata,
                viewId: payload?.view?.id,
                viewType: 'slowquiz_post_comment_dialog',
                comment: state?.slowquiz_post_comment_submit_comment?.value ?? null,
                type: 'user',
                user: payload?.user?.id,
            })));
        });
    }
    #showRegisterQuizDialog({ triggerId }) {
        return this.#slack.views.open({
            trigger_id: triggerId,
            view: registerQuizDialog_1.default,
        });
    }
    #showListQuizDialog({ triggerId, user }) {
        const games = this.#state.games.filter((game) => (game.author === user && game.status === 'waitlisted'));
        return this.#slack.views.open({
            trigger_id: triggerId,
            view: (0, listQuizDialog_1.default)(games),
        });
    }
    #showAnswerQuestionDialog({ triggerId, id, user, channel, }) {
        const game = this.#state.games.find((g) => g.id === id);
        if (!game) {
            this.#postEphemeral('Error: 問題が見つかりません', user, channel);
            return null;
        }
        if (!Array.isArray(game.comments)) {
            game.comments = [];
        }
        if (game.author === user) {
            return this.#slack.views.open({
                trigger_id: triggerId,
                view: (0, gameDetailsDialog_1.default)(game),
            });
        }
        if (game.status !== 'inprogress') {
            this.#postEphemeral('この問題の解答受付は終了しているよ🙄', user, channel);
            return null;
        }
        if (game.answeredUsers.includes(user)) {
            return this.#slack.views.open({
                trigger_id: triggerId,
                view: (0, postCommentDialog_1.default)(game, user),
            });
        }
        if (game.correctAnswers.some((answer) => answer.user === user)) {
            return this.#slack.views.open({
                trigger_id: triggerId,
                view: (0, postCommentDialog_1.default)(game, user),
            });
        }
        return this.#slack.views.open({
            trigger_id: triggerId,
            view: (0, answerQuestionDialog_1.default)(game, this.#getQuestionText(game), user),
        });
    }
    async #registerQuiz({ question, answer, ruby, hint, user, genre, }) {
        if (typeof question !== 'string' || question.length === 0) {
            this.#postEphemeral('問題を入力してね🙄', user);
            return;
        }
        if (typeof answer !== 'string' || answer.length === 0) {
            this.#postEphemeral('答えを入力してね🙄', user);
            return;
        }
        if (typeof ruby !== 'string' || !(/^[ぁ-ゟァ-ヿa-z0-9,]+$/i).exec(ruby)) {
            this.#postEphemeral('読みがなに使える文字は「ひらがな・カタカナ・英数字」のみだよ🙄', user);
            return;
        }
        if (!(0, exports.validateQuestion)(question)) {
            this.#postEphemeral('問題文の長さは原則90文字以下だよ🙄', user);
            return;
        }
        // progressOfComplete の決定
        let progressOfComplete = 0;
        if (question.split('/').length >= 5) {
            progressOfComplete = question.split('/').length;
        }
        else {
            progressOfComplete = question.length;
            const lastCharacter = (0, lodash_1.last)(Array.from(question));
            if (['。', '？', '?'].includes(lastCharacter)) {
                progressOfComplete--;
            }
        }
        this.#state.games.push({
            id: Math.floor(Math.random() * 10000000000).toString(),
            question,
            answer,
            ruby,
            hint: hint || null,
            author: user,
            registrationDate: Date.now(),
            startDate: null,
            finishDate: null,
            status: 'waitlisted',
            progress: 0,
            progressOfComplete,
            completed: false,
            days: 0,
            correctAnswers: [],
            wrongAnswers: [],
            answeredUsers: [],
            comments: [],
            genre,
        });
        (0, achievements_1.increment)(user, 'slowquiz-register-quiz');
        await this.#postShortMessage({
            text: `${(0, util_1.getUserMention)(user)}が1日1文字クイズの問題を登録したよ💪`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `${(0, util_1.getUserMention)(user)}が1日1文字クイズの問題を登録したよ💪`,
                    },
                },
            ],
        });
    }
    async #getChatGptAnswer(game) {
        log.info(`Getting ChatGPT answer for game ${game.id}...`);
        const prompt = await promptLoader.load();
        const questionText = this.#getQuestionText(game);
        const [visibleText] = questionText.split('\u200B');
        log.info('Requesting to OpenAI API...');
        const completion = await openai_1.default.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                ...prompt,
                {
                    role: 'user',
                    content: [
                        'ありがとうございます。以下の文章も、クイズの問題文の途中までを表示したものです。この文章の続きを推測し、問題の答えと読みを教えてください。',
                        '',
                        `問題: ${visibleText}`,
                    ].join('\n'),
                },
            ],
            max_tokens: 1024,
        });
        log.info(`OpenAI API response: ${JSON.stringify(completion)}`);
        const result = completion.choices?.[0]?.message?.content;
        if (typeof result !== 'string') {
            return {
                answer: null,
                result: null,
            };
        }
        const answer = this.#extractAnswerFromResponse(result, completion.model);
        return {
            answer,
            result,
        };
    }
    async #createO4MiniBatchJob(game) {
        log.info(`Creating o4-mini batch job for game ${game.id}...`);
        const prompt = await reasoningPromptLoader.load();
        const questionText = this.#getQuestionText(game);
        const [visibleText] = questionText.split('\u200B');
        const botId = 'o4-mini:ver1';
        const userId = `bot:${botId}`;
        const wrongAnswers = game.wrongAnswers
            .filter((answer) => answer.user === userId)
            .map((answer) => answer.answer);
        const requestBody = {
            model: 'o4-mini',
            messages: [
                ...prompt,
                {
                    role: 'user',
                    content: [
                        `問題文: ${visibleText}`,
                        `残り文字数: ${game.progressOfComplete - game.progress}`,
                        `これまでの誤答: ${wrongAnswers.length > 0 ? wrongAnswers.join(', ') : 'なし'}`,
                    ].join('\n'),
                },
            ],
            // 25,000 is recommended, but it will be too expensive for this game
            // Input tokens: $0.55 / 1M * 2,000 = $0.0011
            // Output tokens: $2.20 / 1M * 3,000 = $0.0066
            max_completion_tokens: this.#MAX_O4_MINI_OUTPUT_TOKENS,
        };
        // https://platform.openai.com/docs/api-reference/batch/request-input
        const batchRequest = {
            custom_id: `slowquiz_${game.id}_day${game.days}`,
            method: 'POST',
            url: '/v1/chat/completions',
            body: requestBody,
        };
        try {
            const batch = await openai_1.systemOpenAIClient.batches.create({
                input_file_id: await this.#createBatchFile([batchRequest]),
                endpoint: '/v1/chat/completions',
                completion_window: '24h',
            });
            const batchJob = {
                id: batch.id,
                gameId: game.id,
                model: 'o4-mini',
                status: 'pending',
                createdAt: Date.now(),
            };
            this.#state.batchJobs.push(batchJob);
            log.info(`Created batch job ${batch.id} for game ${game.id}`);
        }
        catch (error) {
            log.error(`Failed to create batch job for game ${game.id}:`, error);
        }
    }
    async #createBatchFile(requests) {
        const jsonlContent = requests.map((req) => JSON.stringify(req)).join('\n');
        const file = await openai_1.systemOpenAIClient.files.create({
            file: new buffer_1.File([jsonlContent], 'batch_requests.jsonl', { type: 'application/jsonl' }),
            purpose: 'batch',
        });
        return file.id;
    }
    async checkBatchJobs() {
        log.info('Checking batch jobs...');
        for (const batchJob of this.#state.batchJobs) {
            if (batchJob.status === 'pending' || batchJob.status === 'in_progress') {
                try {
                    const batch = await openai_1.systemOpenAIClient.batches.retrieve(batchJob.id);
                    log.info(`Batch job ${batchJob.id} status: ${batch.status}`);
                    if (batch.status === 'completed') {
                        batchJob.status = 'completed';
                        batchJob.completedAt = Date.now();
                        await this.#processBatchResults(batchJob, batch);
                    }
                    else if (batch.status === 'failed') {
                        batchJob.status = 'failed';
                        log.error(`Batch job ${batchJob.id} failed`);
                    }
                    else if (batch.status === 'in_progress') {
                        batchJob.status = 'in_progress';
                    }
                }
                catch (error) {
                    log.error(`Error checking batch job ${batchJob.id}:`, error);
                }
            }
        }
    }
    async #processBatchResults(batchJob, batch) {
        log.info(`Processing batch results for job ${batchJob.id}...`);
        const game = this.#state.games.find((g) => g.id === batchJob.gameId);
        if (!game) {
            log.error(`Game ${batchJob.gameId} not found for batch job ${batchJob.id}`);
            return;
        }
        if (game.status !== 'inprogress') {
            log.info(`Game ${game.id} is not in progress, skipping batch result processing`);
            return;
        }
        const botId = 'o4-mini:ver1';
        const userId = `bot:${botId}`;
        if (game.correctAnswers.some((answer) => answer.user === userId)) {
            log.info(`Game ${game.id} already has an o4-mini answer, skipping`);
            return;
        }
        try {
            const outputFile = await openai_1.systemOpenAIClient.files.content(batch.output_file_id);
            const outputText = await outputFile.text();
            const results = outputText.split('\n').filter((line) => line.trim());
            for (const resultLine of results) {
                const result = JSON.parse(resultLine);
                if (result.custom_id !== `slowquiz_${game.id}_day${game.days}`) {
                    log.warn(`Unexpected custom_id in batch result: ${result.custom_id} (expected: slowquiz_${game.id}_day${game.days})`);
                }
                if (result.response?.body?.usage?.completion_tokens_details?.reasoning_tokens === this.#MAX_O4_MINI_OUTPUT_TOKENS) {
                    log.warn(`Batch job ${batchJob.id} response has ${this.#MAX_O4_MINI_OUTPUT_TOKENS} reasoning tokens, which means it might exceeded the limit. The response might be incomplete.`);
                }
                const content = result.response?.body?.choices?.[0]?.message?.content;
                log.info(`Batch job ${batchJob.id} response content: ${content}`);
                if (content) {
                    batchJob.response = content;
                    const answer = this.#extractAnswerFromResponse(content, batchJob.model);
                    batchJob.answer = answer;
                    log.info(`O4-mini answer for game ${game.id}: ${answer} (${content})`);
                    log.info(`Prompt tokens: ${result.response?.body?.usage?.prompt_tokens}`);
                    log.info(`Completion tokens: ${result.response?.body?.usage?.completion_tokens}`);
                    log.info(`Reasoning tokens: ${result.response?.body?.usage?.completion_tokens_details?.reasoning_tokens}`);
                    if (answer !== null) {
                        this.#answerQuestion({
                            type: 'bot',
                            game,
                            ruby: answer,
                            user: botId,
                        });
                    }
                    if (content !== null) {
                        await this.#postComment({
                            id: game.id,
                            viewId: null,
                            viewType: null,
                            comment: content,
                            type: 'bot',
                            user: botId,
                        });
                    }
                    break;
                }
            }
        }
        catch (error) {
            log.error(`Error processing batch results for job ${batchJob.id}:`, error);
        }
    }
    #extractAnswerFromResponse(content, model) {
        if (model === 'o4-mini') {
            const matches = (/最終解答[:：]\s*(?<answer>.+?)(?<rubyParens>（(?<ruby>.+?)）)?$/m).exec(content);
            if (matches?.groups?.ruby) {
                return matches.groups.ruby.replaceAll(/[^ぁ-ゟァ-ヿa-z0-9]/ig, '') ?? null;
            }
            if (matches?.groups?.answer) {
                return matches.groups.answer.replaceAll(/[^ぁ-ゟァ-ヿa-z0-9]/ig, '') ?? null;
            }
            return null;
        }
        let answer = null;
        const answerMatches = (/【(?<answer>.+?)】/).exec(content);
        if (answerMatches?.groups?.answer) {
            answer = answerMatches.groups.answer;
        }
        const rubyMatches = (/[（(](?<ruby>.+?)[）)]/).exec(answer ?? '');
        if (rubyMatches?.groups?.ruby) {
            answer = rubyMatches.groups.ruby;
        }
        answer = answer?.replaceAll(/[^ぁ-ゟァ-ヿa-z0-9]/ig, '');
        if (!answer) {
            answer = null;
        }
        return answer;
    }
    #answerUserQuestion({ id, ruby, comment, user, }) {
        const game = this.#state.games.find((g) => g.id === id);
        if (!game) {
            this.#postEphemeral('Error: 問題が見つかりません', user);
            return;
        }
        if (game.author === user) {
            this.#postEphemeral('出題者は問題に答えることができないよ🙄', user);
            return;
        }
        if (game.status !== 'inprogress' || game.correctAnswers.length >= this.#MAX_CORRECT_ANSWERS) {
            this.#postEphemeral('Error: この問題の解答受付は終了しています', user);
            return;
        }
        if (game.answeredUsers.includes(user)) {
            this.#postEphemeral('Error: この問題にすでに解答しています', user);
            return;
        }
        if (!(/^[ぁ-ゟァ-ヿa-z0-9]+$/i).exec(ruby)) {
            this.#postEphemeral('答えに使える文字は「ひらがな・カタカナ・英数字」のみだよ🙄', user);
            return;
        }
        // Handle optional comment
        if (comment && comment.trim()) {
            this.#postComment({
                id,
                viewId: null,
                viewType: null,
                comment: comment.trim(),
                type: 'user',
                user,
            });
        }
        this.#answerQuestion({
            type: 'user',
            game,
            ruby,
            user,
        });
    }
    async #createBotAnswers() {
        log.info('Creating bot answers...');
        for (const game of this.#state.games) {
            log.info(`Processing game ${game.id}...`);
            const botId = 'chatgpt-4o-mini:ver1';
            const userId = `bot:${botId}`;
            if (game.status !== 'inprogress') {
                log.info(`Game ${game.id} is not in progress, skipping...`);
                continue;
            }
            if (game.correctAnswers.some((answer) => answer.user === userId)) {
                log.info(`Game ${game.id} already has a bot answer, skipping...`);
                continue;
            }
            const { answer, result } = await this.#getChatGptAnswer(game);
            log.info(`Bot answer for game ${game.id}: ${answer} (${result})`);
            if (answer !== null) {
                this.#answerQuestion({
                    type: 'bot',
                    game,
                    ruby: answer,
                    user: botId,
                });
            }
            if (result !== null) {
                await this.#postComment({
                    id: game.id,
                    viewId: null,
                    viewType: null,
                    comment: result,
                    type: 'bot',
                    user: botId,
                });
            }
        }
    }
    async #createO4MiniBatchJobs() {
        log.info('Creating o4-mini batch jobs...');
        for (const game of this.#state.games) {
            if (game.status !== 'inprogress') {
                continue;
            }
            const existingBatchJob = this.#state.batchJobs.find((job) => (job.gameId === game.id && job.model === 'o4-mini' && job.status === 'pending'));
            if (existingBatchJob) {
                log.info(`Game ${game.id} already has a batch job, skipping...`);
                continue;
            }
            const botId = 'o4-mini:ver1';
            const userId = `bot:${botId}`;
            if (game.correctAnswers.some((answer) => answer.user === userId)) {
                log.info(`Game ${game.id} already has an o4-mini answer, skipping...`);
                continue;
            }
            await this.#createO4MiniBatchJob(game);
        }
    }
    #answerQuestion({ type, game, ruby, user, }) {
        const userId = type === 'user' ? user : `bot:${user}`;
        const userMention = (0, util_1.getUserMention)(userId);
        game.answeredUsers.push(userId);
        const normalizedRuby = (0, japanese_1.hiraganize)(ruby).toLowerCase().trim();
        const isCorrect = game.ruby.split(',').some((correctAnswer) => {
            const normalizedCorrectRuby = (0, japanese_1.hiraganize)(correctAnswer).toLowerCase().trim();
            return normalizedRuby === normalizedCorrectRuby;
        });
        if (!isCorrect) {
            game.wrongAnswers ??= [];
            game.wrongAnswers.push({
                user: userId,
                progress: game.progress,
                days: game.days,
                date: Date.now(),
                answer: ruby,
            });
            if (type === 'user') {
                this.#postEphemeral('残念！🙄', user);
                (0, achievements_1.increment)(user, 'slowquiz-wrong-answer');
            }
            this.#updateLatestStatusMessages();
            return;
        }
        game.correctAnswers.push({
            user: userId,
            progress: game.progress,
            days: game.days,
            date: Date.now(),
            answer: ruby,
        });
        if (type === 'user') {
            this.#postEphemeral('正解です🎉🎉🎉', user);
        }
        this.#postShortMessage({
            text: `${userMention}が1日1文字クイズに正解しました🎉🎉🎉`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `${userMention}が1日1文字クイズに正解しました🎉🎉🎉`,
                    },
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'plain_text',
                            text: this.#getQuestionText(game),
                        },
                    ],
                },
            ],
        });
        if (type === 'user') {
            (0, achievements_1.increment)(user, 'slowquiz-correct-answer');
            if (game.days === 1) {
                (0, achievements_1.increment)(user, 'slowquiz-correct-answer-first-letter');
                if (game.genre === 'normal' && game.question.split('/').length < 5) {
                    (0, achievements_1.increment)(user, 'slowquiz-normal-correct-answer-first-letter');
                }
            }
            if (game.days <= 3) {
                (0, achievements_1.increment)(user, 'slowquiz-correct-answer-le-third-letter');
            }
            if (game.correctAnswers.length === 1) {
                (0, achievements_1.increment)(user, 'slowquiz-first-correct-answer');
            }
        }
        if (type === 'bot') {
            (0, achievements_1.increment)(game.author, 'slowquiz-correct-answer-by-bot');
            if (game.correctAnswers.length === 1) {
                (0, achievements_1.increment)(game.author, 'slowquiz-first-correct-answer-by-bot');
            }
        }
        this.#checkGameEnd();
        this.#updateLatestStatusMessages();
    }
    async #postComment({ id, viewId, viewType, comment, type, user, }) {
        const game = this.#state.games.find((g) => g.id === id);
        const userId = type === 'user' ? user : `bot:${user}`;
        if (!game) {
            if (type === 'user') {
                this.#postEphemeral('Error: 問題が見つかりません', user);
            }
            return;
        }
        if (game.status === 'finished') {
            if (type === 'user') {
                this.#postEphemeral('Error: この問題の解答受付は終了しています', user);
            }
            return;
        }
        if (!Array.isArray(game.comments)) {
            game.comments = [];
        }
        game.comments.push({
            user: userId,
            progress: game.progress,
            days: game.days,
            date: Date.now(),
            answer: comment,
        });
        if (type === 'user' && viewId !== null && viewType !== null) {
            if (viewType === 'slowquiz_answer_dialog') {
                await this.#slack.views.update({
                    view_id: viewId,
                    view: (0, answerQuestionDialog_1.default)(game, this.#getQuestionText(game), user),
                });
            }
            else if (viewType === 'slowquiz_post_comment_dialog') {
                await this.#slack.views.update({
                    view_id: viewId,
                    view: (0, postCommentDialog_1.default)(game, user),
                });
            }
        }
    }
    #deleteQuiz({ viewId, id, user }) {
        const gameIndex = this.#state.games.findIndex((g) => g.id === id);
        if (gameIndex === -1) {
            this.#postEphemeral('Error: 問題が見つかりません', user);
            return null;
        }
        const removedGame = this.#state.games[gameIndex];
        if (removedGame.status !== 'waitlisted') {
            this.#postEphemeral('Error: 出題待ちの問題ではありません', user);
            return null;
        }
        this.#state.games.splice(gameIndex, 1);
        const games = this.#state.games.filter((game) => (game.author === user && game.status === 'waitlisted'));
        return this.#slack.views.update({
            view_id: viewId,
            view: (0, listQuizDialog_1.default)(games),
        });
    }
    #showGameDetailsDialog({ triggerId, id, user, channel, }) {
        const game = this.#state.games.find((g) => g.id === id);
        if (!game) {
            this.#postEphemeral('Error: 問題が見つかりません', user, channel);
            return null;
        }
        if (!Array.isArray(game.comments)) {
            game.comments = [];
        }
        if (game.status !== 'finished') {
            this.#postEphemeral('Error: この問題は終了していません', user, channel);
            return null;
        }
        return this.#slack.views.open({
            trigger_id: triggerId,
            view: (0, gameDetailsDialog_1.default)(game),
        });
    }
    async progressGames() {
        const newGame = this.#chooseNewGame();
        if (newGame !== null) {
            newGame.status = 'inprogress';
            newGame.startDate = Date.now();
        }
        for (const game of this.#state.games) {
            if (game.status === 'inprogress') {
                game.progress++;
                game.days++;
                const { text } = this.#getVisibleQuestionText(game);
                // 括弧で終わるならもう1文字
                if (((0, lodash_1.last)(Array.from(text)) ?? '').match(/^[\p{Ps}\p{Pe}]$/u)) {
                    game.progress++;
                }
                if (game.progress === game.progressOfComplete && !game.completed) {
                    game.completed = true;
                    if (game.correctAnswers.length > 0) {
                        (0, achievements_1.increment)(game.author, 'slowquiz-complete-quiz');
                    }
                }
            }
            game.answeredUsers = [];
        }
        await this.#checkGameEnd();
        if (this.#state.games.some((game) => game.status === 'inprogress')) {
            await this.postGameStatus(true);
        }
        await this.#createBotAnswers();
        await this.#createO4MiniBatchJobs();
    }
    async postGameStatus(replaceLatestStatusMessages, channels = []) {
        const blocks = await this.#getGameBlocks();
        const messages = await this.#postMessage({
            text: '現在開催中の1日1文字クイズ一覧',
            blocks,
        }, ...(channels.length > 0 ? [channels] : []));
        const newStatusMessages = messages.map((message) => ({
            ts: message.ts,
            channel: message.channel,
        }));
        if (replaceLatestStatusMessages) {
            this.#state.latestStatusMessages = newStatusMessages;
        }
        else {
            this.#state.latestStatusMessages.push(...newStatusMessages);
        }
    }
    #chooseNewGame() {
        // これまでの出題者のリスト
        const authorHistory = this.#state.games
            .filter((game) => game.status !== 'waitlisted')
            .sort((a, b) => b.startDate - a.startDate)
            .map((game) => game.author);
        // 最近選ばれた順の出題者のリスト
        const uniqueAuthorHistory = [];
        for (const author of authorHistory) {
            if (!uniqueAuthorHistory.includes(author)) {
                uniqueAuthorHistory.push(author);
            }
        }
        // 一度も選ばれてないユーザーの問題から選ぶ
        const authorHistorySet = new Set(authorHistory);
        const unchosenGames = this.#state.games
            .filter((game) => !authorHistorySet.has(game.author) && game.status === 'waitlisted');
        if (unchosenGames.length > 0) {
            return (0, lodash_1.minBy)(unchosenGames, (game) => game.registrationDate);
        }
        // 最近選ばれていないユーザーを優先して選ぶ
        for (const author of uniqueAuthorHistory.slice().reverse()) {
            const authorGames = this.#state.games
                .filter((game) => game.author === author && game.status === 'waitlisted');
            if (authorGames.length > 0) {
                return (0, lodash_1.minBy)(authorGames, (game) => game.registrationDate);
            }
        }
        // あきらめ
        return null;
    }
    async #checkGameEnd() {
        for (const game of this.#state.games) {
            if (game.status !== 'inprogress') {
                continue;
            }
            if (game.correctAnswers.length >= this.#MAX_CORRECT_ANSWERS ||
                (game.progress > game.progressOfComplete && game.completed)) {
                game.status = 'finished';
                game.finishDate = Date.now();
                this.#postMessage({
                    text: '1日1文字クイズの解答受付が終了しました',
                    blocks: [
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: '～解答受付終了～',
                                emoji: true,
                            },
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: (0, common_tags_1.stripIndent) `
									＊Q. ${game.question}＊

									＊A. ${game.answer} (${game.ruby})＊

									出題者: ${(0, util_1.getUserMention)(game.author)}
								`,
                            },
                            accessory: {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '詳細情報',
                                    emoji: true,
                                },
                                value: game.id,
                                style: 'primary',
                                action_id: 'slowquiz_show_game_details_button',
                            },
                        },
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: '正解者一覧',
                                emoji: true,
                            },
                        },
                        ...await Promise.all(game.correctAnswers.map(async (answer, i) => ({
                            type: 'context',
                            elements: [
                                {
                                    type: 'mrkdwn',
                                    text: `*${i + 1}位* ${(0, util_1.getUserMention)(answer.user)} (${answer.progress}文字)`,
                                },
                                {
                                    type: 'image',
                                    image_url: await (0, util_1.getUserIcon)(answer.user),
                                    alt_text: await (0, util_1.getUserName)(answer.user),
                                },
                            ],
                        }))),
                    ],
                });
            }
        }
    }
    async #updateLatestStatusMessages() {
        const blocks = [
            ...await this.#getGameBlocks(),
            ...footer_1.default,
        ];
        for (const message of this.#state.latestStatusMessages) {
            await this.#slack.chat.update({
                ts: message.ts,
                channel: message.channel,
                text: '現在開催中の1日1文字クイズ一覧',
                blocks,
            });
        }
    }
    async #getGameBlocks() {
        const ongoingGames = this.#state.games
            .filter((game) => game.status === 'inprogress')
            .sort((a, b) => a.startDate - b.startDate);
        if (ongoingGames.length === 0) {
            return [{
                    type: 'section',
                    text: {
                        type: 'plain_text',
                        text: '現在開催中の1日1文字クイズはないよ！',
                    },
                }];
        }
        const blocks = [];
        for (const game of ongoingGames) {
            const questionText = this.#getQuestionText(game);
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `＊Q. ${questionText}＊`,
                },
                accessory: {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: '解答する',
                        emoji: true,
                    },
                    value: game.id,
                    style: 'primary',
                    action_id: 'slowquiz_answer_question_button',
                },
            });
            blocks.push({
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: (0, common_tags_1.oneLine) `
							${await (0, util_1.getUserName)(game.author)} さんの問題 /
							【${getGenreText(game.genre)}】 /
							本日${game.answeredUsers.length}人解答 /
							${game.correctAnswers.length}人正解済み
						`,
                    },
                    ...await Promise.all(game.correctAnswers.map(async (correctAnswer) => ({
                        type: 'image',
                        image_url: (await (0, util_1.getUserIcon)(correctAnswer.user)) ?? 'https://slack.com/img/icons/app-57.png',
                        alt_text: (await (0, util_1.getUserName)(correctAnswer.user)) ?? 'ユーザー',
                    }))),
                ],
            });
        }
        return blocks;
    }
    #getQuestionText(game) {
        if (game.question.split('/').length >= 5) {
            const tokens = game.question.split('/');
            const visibleTokens = tokens.slice(0, game.progress);
            const invisibleTokens = tokens.slice(game.progress);
            const visibleText = visibleTokens.join('');
            const invisibleText = invisibleTokens.map((token, i) => (Array.from(token).map((char, j, tokenChars) => {
                if (i === invisibleTokens.length - 1 &&
                    j === tokenChars.length - 1 &&
                    ['。', '？', '?'].includes(char)) {
                    return char;
                }
                return '◯';
            }).join('\u200B'))).join('/');
            return `${visibleText}\u200B${invisibleText}`;
        }
        const lastCharacter = (0, lodash_1.last)(Array.from(game.question));
        const { text, invisibleCharacters } = this.#getVisibleQuestionText(game);
        const invisibleText = Array(invisibleCharacters).fill('').map((char, i) => {
            if (i === invisibleCharacters - 1 &&
                ['。', '？', '?'].includes(lastCharacter)) {
                return lastCharacter;
            }
            return '◯';
        }).join('\u200B');
        return `${text}\u200B${invisibleText}`;
    }
    #getVisibleQuestionText(game) {
        if (game.question.split('/').length >= 5) {
            return { text: '', invisibleCharacters: 0 };
        }
        const characters = Array.from(game.question);
        let text = '';
        let progress = 0;
        let isInParenthesis = false;
        let invisibleCharacters = 0;
        for (const character of characters) {
            if (progress >= game.progress) {
                progress++;
                invisibleCharacters++;
            }
            else {
                text += character;
                if (isInParenthesis) {
                    if (character === '】') {
                        isInParenthesis = false;
                    }
                }
                else {
                    if (character === '【') {
                        isInParenthesis = true;
                    }
                    else {
                        progress++;
                    }
                }
            }
        }
        return { text, invisibleCharacters };
    }
    async #postMessage(message, channels = [process.env.CHANNEL_SANDBOX, process.env.CHANNEL_QUIZ]) {
        const messages = [];
        for (const channel of channels) {
            const response = await this.#slack.chat.postMessage({
                channel,
                username: '1日1文字クイズ',
                icon_emoji: ':face_with_rolling_eyes:',
                ...message,
                blocks: [
                    ...(message.blocks ?? []),
                    ...footer_1.default,
                ],
            });
            messages.push(response);
        }
        return messages;
    }
    #postShortMessage(message) {
        return this.#slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: '1日1文字クイズ',
            icon_emoji: ':face_with_rolling_eyes:',
            ...message,
        });
    }
    #postEphemeral(message, user, channel = process.env.CHANNEL_SANDBOX) {
        return this.#slack.chat.postEphemeral({
            channel,
            text: message,
            user,
        });
    }
}
exports.SlowQuiz = SlowQuiz;
const server = ({ webClient: slack, messageClient: slackInteractions }) => {
    const callback = async (fastify, opts, next) => {
        const slowquiz = new SlowQuiz({ slack, slackInteractions });
        await slowquiz.initialize();
        fastify.post('/slash/slow-quiz', (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            mutex.runExclusive(async () => {
                log.info('Received /slow-quiz command');
                await slowquiz.postGameStatus(false, [req.body.channel_id]);
            });
            return {
                response_type: 'in_channel',
                text: 'Working...',
            };
        });
        (0, node_schedule_1.scheduleJob)('0 10 * * *', () => {
            mutex.runExclusive(() => {
                slowquiz.progressGames();
            });
        });
        // Check batch jobs every hour
        (0, node_schedule_1.scheduleJob)('30 * * * *', () => {
            mutex.runExclusive(() => {
                slowquiz.checkBatchJobs();
            });
        });
        next();
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
