"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelloWorld = void 0;
const crypto_1 = require("crypto");
const async_mutex_1 = require("async-mutex");
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const state_1 = __importDefault(require("../lib/state"));
const counterEditDialog_1 = __importDefault(require("./views/counterEditDialog"));
const helloWorldMessage_1 = __importDefault(require("./views/helloWorldMessage"));
const mutex = new async_mutex_1.Mutex();
const log = logger_1.default.child({ bot: 'helloworld' });
class HelloWorld {
    #slack;
    #interactions;
    #eventClient;
    #state;
    #SANDBOX_ID = process.env.CHANNEL_SANDBOX ?? '';
    #AUTHORITY = (0, slackUtils_1.getAuthorityLabel)();
    // インスタンスを生成するためのファクトリメソッド
    static async create(slack) {
        log.info('Creating helloworld bot instance');
        const state = await state_1.default.init('helloworld', {
            uuid: (0, crypto_1.randomUUID)(),
            counter: 0,
            latestStatusMessage: null,
        });
        return new HelloWorld(slack, state);
    }
    constructor(slack, state) {
        this.#slack = slack.webClient;
        this.#interactions = slack.messageClient;
        this.#eventClient = slack.eventClient;
        this.#state = state;
        if (!this.#SANDBOX_ID || this.#SANDBOX_ID === 'CXXXXXXXX') {
            throw new Error('CHANNEL_SANDBOX環境変数が設定されていません');
        }
        // 「+1」ボタンが押された時
        this.#interactions.action({
            type: 'button',
            actionId: `helloworld_${this.#state.uuid}_increment_1_button`,
        }, (payload) => {
            log.info(`${payload.user.name} incremented the counter by 1`);
            mutex.runExclusive(() => (this.setCounterValue(this.#state.counter + 1)));
        });
        // 「編集」ボタンが押された時
        this.#interactions.action({
            type: 'button',
            actionId: `helloworld_${this.#state.uuid}_edit_button`,
        }, (payload) => {
            log.info(`${payload.user.name} clicked the edit button`);
            mutex.runExclusive(() => (this.showCounterEditDialog({
                triggerId: payload.trigger_id,
            })));
        });
        // カウンター編集ダイアログの送信ボタンが押された時
        this.#interactions.viewSubmission(`helloworld_${this.#state.uuid}_edit_counter_dialog`, (payload) => {
            const stateObjects = Object.values(payload.view.state.values ?? {});
            const stateValues = Object.assign({}, ...stateObjects);
            mutex.runExclusive(() => (this.setCounterValue(parseInt(stateValues.counter_input.value) || 0)));
        });
        // 「Hello」というメッセージが#sandboxに送信された時
        this.#eventClient.on('message', async (event) => {
            const message = (0, slackUtils_1.extractMessage)(event);
            if (message !== null && message.channel === this.#SANDBOX_ID && message.text.match(/^Hello,?$/i)) {
                // 「Hello」というメッセージに対して「World!」と返す
                await this.#slack.chat.postMessage({
                    username: this.username,
                    channel: message.channel,
                    text: 'World!',
                });
            }
        });
    }
    get username() {
        return `helloworld [${this.#AUTHORITY}]`;
    }
    // 「Hello, World!」メッセージを#sandboxに送信する
    async postHelloWorld() {
        if (this.#state.latestStatusMessage?.channel === this.#SANDBOX_ID) {
            const timestamp = new Date(parseInt(this.#state.latestStatusMessage.ts) * 1000);
            const elapsed = (Date.now() - timestamp.getTime()) / 1000;
            // 直近のメッセージが60分以内に投稿されている場合は何もせず終了
            if (elapsed < 60 * 60) {
                log.info('Skipping postHelloWorld because the latest message was posted less than 60 minutes ago');
                return;
            }
            // 直近のメッセージが60分以上前に投稿されている場合は削除して投稿し直す
            log.info('Removing last status message because the latest message was posted more than 60 minutes ago');
            await this.#slack.chat.delete({
                channel: this.#state.latestStatusMessage.channel,
                ts: this.#state.latestStatusMessage.ts,
            });
        }
        const result = await this.#slack.chat.postMessage({
            username: this.username,
            channel: process.env.CHANNEL_SANDBOX,
            text: 'Hello, World!',
            blocks: (0, helloWorldMessage_1.default)(this.#state),
        });
        this.#state.latestStatusMessage = {
            ts: result.ts,
            channel: result.channel,
        };
    }
    // カウンターの値を設定する
    async setCounterValue(value) {
        log.info(`Setting counter value to ${value}`);
        this.#state.counter = value;
        if (!this.#state.latestStatusMessage) {
            log.error('latestStatusMessage is not set');
            return;
        }
        // 「Hello, World!」メッセージを更新する
        await this.#slack.chat.update({
            channel: this.#state.latestStatusMessage.channel,
            ts: this.#state.latestStatusMessage.ts,
            text: 'Hello, World!',
            blocks: (0, helloWorldMessage_1.default)(this.#state),
        });
    }
    // カウンター編集ダイアログを表示する
    async showCounterEditDialog({ triggerId }) {
        log.info('Showing counter edit dialog');
        await this.#slack.views.open({
            trigger_id: triggerId,
            view: (0, counterEditDialog_1.default)(this.#state),
        });
    }
}
exports.HelloWorld = HelloWorld;
