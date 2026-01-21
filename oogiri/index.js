"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const lodash_1 = require("lodash");
const slackUtils_1 = require("../lib/slackUtils");
const utils_1 = require("../lib/utils");
const mutex = new async_mutex_1.Mutex();
class Oogiri {
    eventClient;
    slack;
    slackInteractions;
    state;
    loadDeferred;
    previousTick;
    constructor({ eventClient, slack, slackInteractions, }) {
        this.eventClient = eventClient;
        this.slack = slack;
        this.slackInteractions = slackInteractions;
        this.loadDeferred = new utils_1.Deferred();
        this.previousTick = 0;
        this.state = {
            games: [],
        };
    }
    async initialize() {
        if (this.loadDeferred.isResolved) {
            return this.loadDeferred.promise;
        }
        const statePath = path_1.default.resolve(__dirname, 'state.json');
        const stateExists = await fs_1.promises.access(statePath, fs_1.constants.F_OK).then(() => true).catch(() => false);
        if (stateExists) {
            const stateData = await fs_1.promises.readFile(statePath);
            Object.assign(this.state, JSON.parse(stateData.toString()));
        }
        this.eventClient.on('message', async (message) => {
            if (!message.text || message.subtype || message.channel !== process.env.CHANNEL_SANDBOX) {
                return;
            }
            if (message.text === '大喜利') {
                await this.showStatus();
            }
        });
        this.slackInteractions.action({
            type: 'dialog_submission',
            callbackId: 'oogiri_start_dialog',
        }, (payload, respond) => {
            mutex.runExclusive(() => (this.startOogiri({
                title: payload.submission.title,
                coins: payload.submission.coins,
                meanings: payload.submission.meanings,
                respond,
                user: payload.user.id,
            })));
        });
        this.slackInteractions.action({
            type: 'button',
            blockId: /^oogiri_add_meaning/,
        }, (payload, respond) => {
            const [action] = payload.actions;
            mutex.runExclusive(() => (this.showMeaningDialog({
                triggerId: payload.trigger_id,
                user: payload.user.id,
                id: action.value,
                respond,
            })));
        });
        this.slackInteractions.action({
            type: 'dialog_submission',
            callbackId: 'oogiri_add_meaning_dialog',
        }, (payload, respond) => {
            mutex.runExclusive(() => (this.registerMeaning({
                id: payload.state,
                meanings: Object.entries(payload.submission).filter(([key]) => key.startsWith('meaning')).map(([, meaning]) => meaning),
                user: payload.user.id,
                respond,
            })));
        });
        this.slackInteractions.action({
            type: 'button',
            blockId: /^oogiri_end_meaning/,
        }, (payload) => {
            const [action] = payload.actions;
            mutex.runExclusive(() => (this.finishMeaning(action.value)));
        });
        this.slackInteractions.action({
            type: 'button',
            blockId: /^oogiri_betting/,
        }, (payload, respond) => {
            const [action] = payload.actions;
            const [id, choiceText] = action.value.split(',');
            const choice = parseInt(choiceText);
            mutex.runExclusive(() => (this.showBettingDialog({
                triggerId: payload.trigger_id,
                id,
                choice: Number.isNaN(choice) ? null : choice,
                user: payload.user.id,
                respond,
            })));
        });
        this.slackInteractions.action({
            type: 'dialog_submission',
            callbackId: 'oogiri_add_betting_dialog',
        }, (payload, respond) => {
            mutex.runExclusive(() => (this.registerBetting({
                id: payload.state,
                choice: payload.submission.choice,
                coins: payload.submission.coins,
                user: payload.user.id,
                respond,
            })));
        });
        this.slackInteractions.action({
            type: 'button',
            blockId: 'oogiri_end_betting',
        }, (payload) => {
            const [action] = payload.actions;
            mutex.runExclusive(() => (this.finishBetting(action.value)));
        });
        this.loadDeferred.resolve();
        return this.loadDeferred.promise;
    }
    showStartDialog(triggerId, text = '') {
        if (this.state.games.length >= 3) {
            return '大喜利を同時に3つ以上開催することはできないよ:imp:';
        }
        return this.slack.dialog.open({
            trigger_id: triggerId,
            dialog: {
                callback_id: 'oogiri_start_dialog',
                title: '大喜利設定',
                submit_label: '開始する',
                notify_on_cancel: true,
                elements: [
                    {
                        type: 'text',
                        label: 'タイトル',
                        name: 'title',
                        value: text,
                        hint: '大喜利のタイトルを入力してください',
                    },
                    {
                        type: 'select',
                        label: '1人あたりの意味登録可能数',
                        name: 'meanings',
                        options: (0, lodash_1.times)(5, (index) => ({
                            label: `${index + 1}個`,
                            value: (index + 1).toString(),
                        })),
                    },
                    {
                        type: 'select',
                        label: '1人あたりのBET可能枚数',
                        name: 'coins',
                        options: (0, lodash_1.times)(5, (index) => ({
                            label: `${index + 1}枚`,
                            value: (index + 1).toString(),
                        })),
                    },
                ],
            },
        });
    }
    async startOogiri({ title, meanings, coins, respond, user }) {
        if (this.state.games.length > 2) {
            respond({
                text: '大喜利を同時に3つ以上開催することはできないよ👿',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return;
        }
        const now = Date.now();
        const game = {
            time: now,
            id: Math.floor(Math.random() * 10000000).toString(),
            title,
            maxMeanings: parseInt(meanings),
            maxCoins: parseInt(coins),
            status: 'meaning',
            meanings: [],
            meaningMessage: null,
            bettings: Object.create(null),
            bettingMessage: null,
            choices: [],
            author: user,
        };
        await this.setState({
            games: this.state.games.concat([game]),
        });
        const message = await this.postMessage({
            text: '',
            blocks: await this.getMeaningBlocks(game),
        });
        game.meaningMessage = message.ts;
        await this.setState({ games: this.state.games });
    }
    async getMeaningBlocks(game, compact = false) {
        const registrants = await Promise.all((0, lodash_1.uniq)(game.meanings.map((meaning) => meaning.user)).map((user) => (0, slackUtils_1.getMemberName)(user)));
        return [
            {
                type: 'section',
                block_id: `oogiri_add_meaning_${game.id}`,
                text: {
                    type: 'mrkdwn',
                    text: (0, common_tags_1.stripIndent) `
						${compact ? '' : '大喜利を始めるよ～'}
						＊テーマ＊ ${game.title}
						＊設定者＊ <@${game.author}>
					`,
                },
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `＊意味登録可能数＊ ${game.maxMeanings}個`,
                    },
                    {
                        type: 'mrkdwn',
                        text: `＊BET可能枚数＊ ${game.maxCoins}枚`,
                    },
                ],
                accessory: {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: '登録する',
                    },
                    value: game.id,
                },
            },
            {
                type: 'section',
                block_id: `oogiri_end_meaning_${game.id}`,
                text: {
                    type: 'mrkdwn',
                    text: (0, common_tags_1.stripIndent) `
						登録済み: ${registrants.length === 0 ? 'なし' : registrants.map((name) => `@${name}`).join(' ')}
					`,
                },
                accessory: {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: '終了する',
                    },
                    value: game.id,
                    style: 'danger',
                    confirm: {
                        text: {
                            type: 'plain_text',
                            text: `大喜利「${game.title}」の意味登録を締め切りますか？`,
                        },
                        confirm: {
                            type: 'plain_text',
                            text: 'いいよ',
                        },
                        deny: {
                            type: 'plain_text',
                            text: 'だめ',
                        },
                    },
                },
            },
        ];
    }
    showMeaningDialog({ triggerId, id, user, respond }) {
        const game = this.state.games.find((g) => g.id === id);
        if (!game) {
            respond({
                text: 'Error: Game not found',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return null;
        }
        const meanings = game.meanings.filter((meaning) => meaning.user === user);
        return this.slack.dialog.open({
            trigger_id: triggerId,
            dialog: {
                callback_id: 'oogiri_add_meaning_dialog',
                title: '大喜利意味登録',
                submit_label: '登録する',
                notify_on_cancel: true,
                state: game.id,
                elements: [
                    {
                        type: 'text',
                        label: game.title,
                        name: 'meaning1',
                        min_length: 3,
                        value: meanings[0] ? meanings[0].text : '',
                        hint: '後から変更できます',
                    },
                    ...((0, lodash_1.range)(game.maxMeanings - 1).map((i) => ({
                        type: 'text',
                        label: `${i + 2}個目`,
                        name: `meaning${i + 2}`,
                        min_length: 3,
                        value: meanings[i + 1] ? meanings[i + 1].text : '',
                        hint: '後から変更できます',
                        optional: true,
                    }))),
                ],
            },
        });
    }
    async registerMeaning({ id, meanings, user, respond, }) {
        const game = this.state.games.find((g) => g.id === id);
        if (!game) {
            respond({
                text: 'この大喜利の意味登録は終了しているよ😢',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return;
        }
        const beforeCount = (0, lodash_1.uniq)(game.meanings.map((m) => m.user)).length;
        game.meanings = game.meanings
            .filter((meaning) => meaning.user !== user)
            .concat(meanings.filter((meaning) => meaning).map((text) => ({ user, text })));
        await this.setState({
            games: this.state.games,
        });
        const afterCount = (0, lodash_1.uniq)(game.meanings.map((m) => m.user)).length;
        if (beforeCount !== afterCount) {
            await this.postMessage({
                text: (0, common_tags_1.stripIndent) `
					<@${user}>が「${game.title}」に登録したよ💪
					現在の参加者: ${afterCount}人
				`,
            });
            await this.updateMessage({
                text: '',
                ts: game.meaningMessage,
                blocks: await this.getMeaningBlocks(game),
            });
        }
    }
    async finishMeaning(id) {
        const game = this.state.games.find((g) => g.id === id);
        if ((0, lodash_1.isEmpty)(game.meanings)) {
            await this.setState({
                games: this.state.games.filter((g) => g !== game),
            });
            await this.postMessage({
                text: (0, common_tags_1.stripIndent) `
					大喜利「${game.title}」は参加者がいないのでキャンセルされたよ🙄
				`,
            });
            return;
        }
        game.status = 'betting';
        await this.setState({ games: this.state.games });
        const shuffledMeanings = (0, lodash_1.shuffle)(game.meanings);
        // eslint-disable-next-line require-atomic-updates
        game.choices = shuffledMeanings;
        await this.setState({ games: this.state.games });
        const message = await this.postMessage({
            text: '',
            blocks: await this.getBettingBlocks(game),
        });
        game.bettingMessage = message.ts;
        await this.setState({ games: this.state.games });
    }
    async getBettingBlocks(game, compact = false) {
        const mentions = (0, lodash_1.uniq)(game.meanings.map((meaning) => `<@${meaning.user}>`));
        const betters = await Promise.all(Object.keys(game.bettings).map((user) => (0, slackUtils_1.getMemberName)(user)));
        return [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: (0, common_tags_1.stripIndent) `
						${compact ? '' : mentions.join(' ')}
						${compact ? '' : 'ベッティングタイムが始まるよ～👐👐👐'}
						＊テーマ＊ ${game.title}
						＊設定者＊ <@${game.author}>
					`,
                },
            },
            ...game.choices.map((meaning, index) => ({
                type: 'section',
                block_id: `oogiri_betting_${index}`,
                text: {
                    type: 'mrkdwn',
                    text: `${index + 1}. ＊${meaning.text}＊`,
                },
                accessory: {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: `${index + 1}にBETする`,
                    },
                    value: [game.id, index].join(','),
                },
            })),
            {
                type: 'section',
                block_id: 'oogiri_end_betting',
                text: {
                    type: 'mrkdwn',
                    text: (0, common_tags_1.stripIndent) `
						BET済み: ${betters.length === 0 ? 'なし' : betters.map((name) => `@${name}`).join(' ')}
					`,
                },
                accessory: {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: '終了する',
                    },
                    value: game.id,
                    style: 'danger',
                    confirm: {
                        text: {
                            type: 'plain_text',
                            text: `大喜利「${game.title}」のベッティングを締め切りますか？`,
                        },
                        confirm: {
                            type: 'plain_text',
                            text: 'いいよ',
                        },
                        deny: {
                            type: 'plain_text',
                            text: 'だめ',
                        },
                    },
                },
            },
        ];
    }
    showBettingDialog({ triggerId, id, choice, user, respond, }) {
        const game = this.state.games.find((g) => g.id === id);
        if (!game) {
            respond({
                text: 'Error: Game not found',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return null;
        }
        const coins = game.bettings[user] ? game.bettings[user].coins : 1;
        return this.slack.dialog.open({
            trigger_id: triggerId,
            dialog: {
                callback_id: 'oogiri_add_betting_dialog',
                title: '大喜利BET',
                submit_label: 'BETする',
                notify_on_cancel: true,
                state: id,
                elements: [
                    {
                        type: 'select',
                        label: 'BETする意味',
                        name: 'choice',
                        ...(choice === null ? {} : { value: choice.toString() }),
                        hint: '後から変更できます',
                        options: game.choices.map(({ text }, index) => ({
                            label: `${index + 1}. ${text}`,
                            value: index.toString(),
                        })),
                    },
                    {
                        type: 'select',
                        label: 'BETする枚数',
                        name: 'coins',
                        value: coins.toString(),
                        hint: '後から変更できます',
                        options: (0, lodash_1.times)(game.maxCoins, (index) => ({
                            label: `${index + 1}枚`,
                            value: (index + 1).toString(),
                        })),
                    },
                ],
            },
        });
    }
    async registerBetting({ id, choice, coins, user, respond, }) {
        const game = this.state.games.find((g) => g.id === id);
        if (!game || game.status !== 'betting') {
            respond({
                text: 'この大喜利の投票は終了しているよ😢',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return;
        }
        const choiceMeaning = game.choices[parseInt(choice)];
        if (choiceMeaning && choiceMeaning.user === user) {
            respond({
                text: '自分自身には投票できないよ',
                response_type: 'ephemeral',
                replace_original: false,
            });
            return;
        }
        const isNew = !Object.keys(game.bettings).includes(user);
        game.bettings[user] = {
            choice: parseInt(choice),
            coins: parseInt(coins),
        };
        await this.setState({
            games: this.state.games,
        });
        if (isNew) {
            await this.postMessage({
                text: (0, common_tags_1.stripIndent) `
					<@${user}>が「${game.title}」に投票したよ💰
				`,
            });
            await this.updateMessage({
                text: '',
                ts: game.bettingMessage,
                blocks: await this.getBettingBlocks(game),
            });
        }
    }
    async finishBetting(id) {
        const game = this.state.games.find((g) => g.id === id);
        await this.postMessage({
            text: '',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: (0, common_tags_1.stripIndent) `
							結果発表～～
							＊テーマ＊ ${game.title}
						`,
                    },
                },
                ...game.choices.map((meaning, index) => ({
                    type: 'section',
                    block_id: `oogiri_betting_${index}`,
                    text: {
                        type: 'mrkdwn',
                        text: (0, common_tags_1.stripIndent) `
							<@${meaning.user}>
							${index + 1}. ＊${meaning.text}＊
							投票: ${Object.entries(game.bettings).filter(([, betting]) => betting.choice === index).map(([user, betting]) => (`<@${user}> (${betting.coins}枚)`)).join('、')}
						`,
                    },
                })),
            ],
        });
        await this.setState({
            games: this.state.games.filter((g) => g !== game),
        });
    }
    async showStatus() {
        if (this.state.games.length === 0) {
            await this.postMessage({
                text: (0, common_tags_1.stripIndent) `
					現在開催中の大喜利はないよ
					大喜利を開始するには \`/oogiri [テーマ]\` とタイプしてね:heart:
				`,
            });
            return;
        }
        await this.postMessage({
            text: '',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '＊現在開催中の大喜利＊',
                    },
                },
                ...(0, lodash_1.flatten)(await Promise.all(this.state.games.map((game) => {
                    if (game.status === 'meaning') {
                        return this.getMeaningBlocks(game, true);
                    }
                    return this.getBettingBlocks(game, true);
                }))),
            ],
        });
    }
    async setState(object) {
        Object.assign(this.state, object);
        const statePath = path_1.default.resolve(__dirname, 'state.json');
        await fs_1.promises.writeFile(statePath, JSON.stringify(this.state));
    }
    // eslint-disable-next-line camelcase
    postMessage(message) {
        return this.slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: 'oogiri',
            icon_emoji: ':lantern:',
            ...message,
        });
    }
    // eslint-disable-next-line camelcase
    updateMessage(message) {
        return this.slack.chat.update({
            channel: process.env.CHANNEL_SANDBOX,
            ...message,
        });
    }
}
const server = ({ webClient: slack, eventClient, messageClient: slackInteractions }) => {
    const callback = async (fastify, opts, next) => {
        const oogiri = new Oogiri({ slack, eventClient, slackInteractions });
        await oogiri.initialize();
        // eslint-disable-next-line require-await
        fastify.post('/slash/oogiri', async (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            return oogiri.showStartDialog(req.body.trigger_id, req.body.text);
        });
        next();
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
