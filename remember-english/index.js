"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RememberEnglish = void 0;
const async_mutex_1 = require("async-mutex");
const ebisu_js_1 = __importDefault(require("ebisu-js"));
const lodash_1 = require("lodash");
const node_schedule_1 = __importDefault(require("node-schedule"));
const achievements_1 = require("../achievements");
const slackUtils_1 = require("../lib/slackUtils");
const state_1 = __importDefault(require("../lib/state"));
const mutex = new async_mutex_1.Mutex();
class Dictionary {
    models;
    words;
    static t = 30 * 24 * 60 * 60 * 1000;
    constructor(words) {
        this.models = new Map(words.map((word) => ([word.en, ebisu_js_1.default.defaultModel(Dictionary.t)])));
        this.words = new Map(words.map((word) => ([word.en, word])));
    }
    addWord(word) {
        this.models.set(word.en, ebisu_js_1.default.defaultModel(Dictionary.t));
        this.words.set(word.en, word);
    }
    setRecall({ word, success, total, now }) {
        const model = this.models.get(word);
        const wordData = this.words.get(word);
        if (!model || !wordData) {
            throw new Error(`${word} is not in the dictionary`);
        }
        const newModel = ebisu_js_1.default.updateRecall(model, success, total, now - wordData.createdAt);
        this.models.set(word, newModel);
    }
    getForgottenWords(now) {
        const words = Array.from(this.words.keys());
        const wordAndRates = words.map((word) => {
            const model = this.models.get(word);
            return [word, ebisu_js_1.default.predictRecall(model, now - this.words.get(word).createdAt, true)];
        });
        const sortedWords = (0, lodash_1.sortBy)(wordAndRates, ([, rate]) => rate);
        console.log(sortedWords);
        return sortedWords.slice(0, 3).map(([word, rate]) => ({ en: word, forgettingRate: 1 - rate }));
    }
}
class RememberEnglish {
    slack;
    state;
    previousTick;
    dictionary;
    constructor({ slack }) {
        this.slack = slack;
        this.previousTick = 0;
    }
    async initialize() {
        this.state = await state_1.default.init('remember-english', {
            words: [],
            challenges: [],
        });
        this.dictionary = new Dictionary(this.state.words);
        for (const challenge of this.state.challenges) {
            if (!challenge.finished) {
                continue;
            }
            for (const word of challenge.words) {
                this.dictionary.setRecall({
                    word: word.en,
                    success: word.success,
                    total: challenge.participants.length,
                    now: challenge.createdAt,
                });
            }
        }
        node_schedule_1.default.scheduleJob('0 10 * * *', () => {
            mutex.runExclusive(() => (this.dailyJob()));
        });
    }
    dailyJob() {
        let finished = false;
        for (const challenge of this.state.challenges) {
            if (!challenge.finished && challenge.participants.length >= 3) {
                this.finishChallenge(challenge);
                finished = true;
            }
        }
        const unfinishedChallenges = this.state.challenges.filter((challenge) => !challenge.finished);
        if (finished || unfinishedChallenges.length === 0) {
            this.postChallenge();
        }
    }
    finishChallenge(challenge) {
        let successes = 0;
        for (const word of challenge.words) {
            this.dictionary.setRecall({
                word: word.en,
                success: word.success,
                total: challenge.participants.length,
                now: challenge.createdAt,
            });
            successes += word.success;
        }
        challenge.finished = true;
        const totalScore = Math.floor(successes / challenge.participants.length * 100);
        return this.postMessage({
            text: '',
            blocks: [
                {
                    type: 'header',
                    text: (0, slackUtils_1.plainText)('Results'),
                },
                {
                    type: 'section',
                    text: (0, slackUtils_1.mrkdwn)(challenge.words.map((word) => (`●  *${word.en}*: ${this.state.words.find((w) => w.en === word.en).ja} (Score: ${word.success}/${challenge.participants.length})`)).join('\n')),
                },
                {
                    type: 'section',
                    text: (0, slackUtils_1.mrkdwn)(`Total Score: *${totalScore}* / 300\nGood Job! 😁`),
                },
            ],
        });
    }
    async postChallenge() {
        const now = Date.now();
        const id = now.toString();
        const forgottenWords = this.dictionary.getForgottenWords(now);
        const challenge = {
            id,
            createdAt: now,
            words: forgottenWords.map((word) => ({
                en: word.en,
                forgettingRate: word.forgettingRate,
                success: 0,
            })),
            finished: false,
            participants: [],
            ts: null,
        };
        const message = await this.postMessage({
            text: '',
            blocks: await this.getChallengeBlocks(challenge),
        });
        challenge.ts = message.ts;
        this.state.challenges.push(challenge);
    }
    async getChallengeBlocks(challenge) {
        const userIcons = await Promise.all(challenge.participants.map((participant) => (0, slackUtils_1.getMemberIcon)(participant)));
        return [
            {
                type: 'header',
                text: (0, slackUtils_1.plainText)('Do you remember the meaning?'),
            },
            {
                type: 'section',
                text: (0, slackUtils_1.mrkdwn)(challenge.words.map((word) => (`●  *${word.en}* (forget rate: ${(word.forgettingRate * 100).toFixed(1)}%)`)).join('\n')),
            },
            {
                type: 'actions',
                block_id: 'remember_english_post_challenge_actions',
                elements: [
                    {
                        type: 'button',
                        text: (0, slackUtils_1.plainText)('Reveal the answers'),
                        action_id: 'reveal',
                        value: challenge.id,
                        style: 'primary',
                    },
                    {
                        type: 'button',
                        text: (0, slackUtils_1.plainText)('Post “Today\'s English”'),
                        action_id: 'add_word',
                        value: challenge.id,
                    },
                ],
            },
            {
                type: 'context',
                elements: [
                    (0, slackUtils_1.plainText)('participants (3 ppl needed to continue):'),
                    ...(userIcons.map((icon) => ({
                        type: 'image',
                        image_url: icon,
                        alt_text: 'user',
                    }))),
                ],
            },
        ];
    }
    showRevealDialog({ triggerId, id, user, respond }) {
        const challenge = this.state.challenges.find((g) => g.id === id);
        if (!challenge) {
            respond({
                text: 'Error: Challenge not found',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return null;
        }
        if (challenge.finished) {
            respond({
                text: 'Error: Challenge is finished',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return null;
        }
        if (challenge.participants.some((participant) => participant === user)) {
            respond({
                text: 'You already answered this challenge',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return null;
        }
        const words = challenge.words.map(({ en }) => this.state.words.find((w) => w.en === en));
        return this.viewsOpen({
            trigger_id: triggerId,
            view: {
                callback_id: 'remember_english_answer',
                private_metadata: challenge.id,
                type: 'modal',
                title: (0, slackUtils_1.plainText)('Answers'),
                submit: (0, slackUtils_1.plainText)('Record Result'),
                blocks: [
                    ...(words.map((word, i) => ({
                        type: 'input',
                        block_id: `remember_english_answer-${i}`,
                        label: (0, slackUtils_1.plainText)(`${word.en}: ${word.ja}`),
                        element: {
                            type: 'radio_buttons',
                            action_id: 'action',
                            options: [
                                {
                                    text: (0, slackUtils_1.plainText)(':o: I remembered it'),
                                    value: 'correct',
                                },
                                {
                                    text: (0, slackUtils_1.plainText)(':x: I forgot it'),
                                    value: 'incorrect',
                                },
                            ],
                        },
                    }))),
                ],
            },
        });
    }
    showAddWordDialog({ triggerId }) {
        return this.viewsOpen({
            trigger_id: triggerId,
            view: {
                callback_id: 'remember_english_add_word',
                type: 'modal',
                title: (0, slackUtils_1.plainText)('Add Today\'s English'),
                submit: (0, slackUtils_1.plainText)('Add word'),
                blocks: [
                    {
                        type: 'input',
                        block_id: 'remember_english_add_word-en',
                        label: (0, slackUtils_1.plainText)('English'),
                        element: {
                            type: 'plain_text_input',
                            action_id: 'action',
                            placeholder: (0, slackUtils_1.plainText)('programming'),
                        },
                    },
                    {
                        type: 'input',
                        block_id: 'remember_english_add_word-ja',
                        label: (0, slackUtils_1.plainText)('Japanese'),
                        element: {
                            type: 'plain_text_input',
                            action_id: 'action',
                            placeholder: (0, slackUtils_1.plainText)('プログラミング'),
                        },
                    },
                ],
            },
        });
    }
    async recordResult({ id, user, results }) {
        const challenge = this.state.challenges.find((g) => g.id === id);
        if (!challenge || challenge.finished) {
            return;
        }
        if (challenge.participants.some((participant) => participant === user)) {
            return;
        }
        for (const [i, result] of results.entries()) {
            if (result) {
                challenge.words[i].success += 1;
            }
        }
        challenge.participants.push(user);
        await (0, achievements_1.increment)(user, 'remember-english-challenge');
        if (challenge.participants.length === 1) {
            await (0, achievements_1.increment)(user, 'remember-english-challenge-first');
        }
        await this.updateMessage({
            text: '',
            ts: challenge.ts,
            blocks: await this.getChallengeBlocks(challenge),
        });
    }
    async addWord({ en, ja, user }) {
        const now = Date.now();
        const username = await (0, slackUtils_1.getMemberName)(user);
        const icon = await (0, slackUtils_1.getMemberIcon)(user, 192);
        if (this.state.words.some((w) => w.en === en)) {
            return;
        }
        const word = { en, ja, createdAt: now };
        this.state.words.push(word);
        this.dictionary.addWord(word);
        await (0, achievements_1.increment)(user, 'remember-english-add-word');
        await this.postMessage({
            username,
            icon_url: icon,
            text: `Today's English: ${en} (${ja})`,
        });
    }
    // eslint-disable-next-line camelcase
    postMessage(message) {
        // eslint-disable-next-line no-restricted-syntax
        const normalizedMessage = 'icon_url' in message ? {
            ...message,
        } : {
            ...message,
            icon_emoji: ':abcd:',
        };
        return this.slack.chat.postMessage({
            channel: process.env.CHANNEL_SIG_ENGLISH,
            username: 'rememberbot',
            ...normalizedMessage,
        });
    }
    updateMessage(message) {
        return this.slack.chat.update({
            channel: process.env.CHANNEL_SIG_ENGLISH,
            ...message,
        });
    }
    viewsOpen(data) {
        return this.slack.views.open(data);
    }
}
exports.RememberEnglish = RememberEnglish;
exports.default = async ({ webClient: slack, messageClient: slackInteractions }) => {
    const rememberEnglish = new RememberEnglish({ slack });
    await rememberEnglish.initialize();
    slackInteractions.action({
        blockId: 'remember_english_post_challenge_actions',
        actionId: 'reveal',
    }, (payload, respond) => {
        const [action] = payload.actions;
        mutex.runExclusive(() => (rememberEnglish.showRevealDialog({
            triggerId: payload.trigger_id,
            user: payload.user.id,
            id: action.value,
            respond,
        })));
    });
    slackInteractions.action({
        blockId: 'remember_english_post_challenge_actions',
        actionId: 'add_word',
    }, (payload) => {
        mutex.runExclusive(() => (rememberEnglish.showAddWordDialog({
            triggerId: payload.trigger_id,
        })));
    });
    slackInteractions.viewSubmission({
        callbackId: 'remember_english_answer',
    }, (payload) => {
        const values = (0, lodash_1.get)(payload, ['view', 'state', 'values'], {});
        const results = Array(Object.keys(values).length).fill(false);
        for (const [blockId, value] of Object.entries(values)) {
            const [, idStr] = blockId.split('-');
            const id = (0, lodash_1.clamp)(parseInt(idStr) || 0, 0, results.length - 1);
            const optionValue = (0, lodash_1.get)(value, ['action', 'selected_option', 'value'], 'incorrect');
            results[id] = optionValue === 'correct';
        }
        mutex.runExclusive(() => (rememberEnglish.recordResult({
            id: payload.view.private_metadata,
            user: payload.user.id,
            results,
        })));
        return {
            response_action: 'clear',
        };
    });
    slackInteractions.viewSubmission({
        callbackId: 'remember_english_add_word',
    }, (payload) => {
        const en = (0, lodash_1.get)(payload, ['view', 'state', 'values', 'remember_english_add_word-en', 'action', 'value'], '');
        const ja = (0, lodash_1.get)(payload, ['view', 'state', 'values', 'remember_english_add_word-ja', 'action', 'value'], '');
        if (en === '' || ja === '') {
            return {};
        }
        mutex.runExclusive(() => (rememberEnglish.addWord({
            user: payload.user.id,
            en,
            ja,
        })));
        return {
            response_action: 'clear',
        };
    });
};
