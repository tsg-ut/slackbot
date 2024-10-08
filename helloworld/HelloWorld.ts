import {randomUUID} from 'crypto';
import type EventEmitter from 'events';
import os from 'os';
import type {BlockAction, ViewSubmitAction} from '@slack/bolt';
import type {SlackMessageAdapter} from '@slack/interactive-messages';
import type {MessageEvent, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {extractMessage} from '../lib/slackUtils';
import State from '../lib/state';
import counterEditDialog from './views/counterEditDialog';
import helloWorldMessage from './views/helloWorldMessage';

export interface StateObj {
	uuid: string,
	counter: number,
	latestStatusMessage: {ts: string, channel: string} | null,
}

const mutex = new Mutex();

const log = logger.child({bot: 'helloworld'});

export class HelloWorld {
	#slack: WebClient;

	#interactions: SlackMessageAdapter;

	#eventClient: EventEmitter;

	#state: StateObj;

	#SANDBOX_ID = process.env.CHANNEL_SANDBOX!;

	// インスタンスを生成するためのファクトリメソッド
	static async create(slack: SlackInterface) {
		log.info('Creating helloworld bot instance');

		const state = await State.init<StateObj>('helloworld', {
			uuid: randomUUID(),
			counter: 0,
			latestStatusMessage: null,
		});

		return new HelloWorld(slack, state);
	}

	constructor(slack: SlackInterface, state: StateObj) {
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
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} incremented the counter by 1`);
			mutex.runExclusive(() => (
				this.setCounterValue(this.#state.counter + 1)
			));
		});

		// 「編集」ボタンが押された時
		this.#interactions.action({
			type: 'button',
			actionId: `helloworld_${this.#state.uuid}_edit_button`,
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked the edit button`);
			mutex.runExclusive(() => (
				this.showCounterEditDialog({
					triggerId: payload.trigger_id,
				})
			));
		});

		// カウンター編集ダイアログの送信ボタンが押された時
		this.#interactions.viewSubmission(`helloworld_${this.#state.uuid}_edit_counter_dialog`, (payload: ViewSubmitAction) => {
			const stateObjects = Object.values(payload.view.state.values ?? {});
			const stateValues = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.setCounterValue(parseInt(stateValues.counter_input.value))
			));
		});

		// 「Hello」というメッセージが#sandboxに送信された時
		this.#eventClient.on('message', async (event: MessageEvent) => {
			const message = extractMessage(event);
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

	private get username() {
		return `helloworld [${os.hostname()}]`;
	}

	// 「Hello, World!」メッセージを#sandboxに送信する
	async postHelloWorld() {
		if (this.#state.latestStatusMessage.channel === this.#SANDBOX_ID) {
			const timestamp = new Date(parseInt(this.#state.latestStatusMessage.ts) * 1000);
			const elapsed = (Date.now() - timestamp.getTime()) / 1000;
			if (elapsed < 60 * 60) {
				log.info('Skipping postHelloWorld because the latest message was posted less than 60 minutes ago');
				return;
			}
		}

		const result = await this.#slack.chat.postMessage({
			username: this.username,
			channel: process.env.CHANNEL_SANDBOX,
			text: 'Hello, World!',
			blocks: helloWorldMessage(this.#state),
		});

		this.#state.latestStatusMessage = {
			ts: result.ts,
			channel: result.channel,
		};
	}

	// カウンターの値を設定する
	private async setCounterValue(value: number) {
		log.info(`Setting counter value to ${value}`);
		this.#state.counter = value;

		if (!this.#state.latestStatusMessage) {
			log.warn('latestStatusMessage is not set');
			return;
		}

		// 「Hello, World!」メッセージを更新する
		await this.#slack.chat.update({
			channel: this.#state.latestStatusMessage.channel,
			ts: this.#state.latestStatusMessage.ts,
			text: 'Hello, World!',
			blocks: helloWorldMessage(this.#state),
		});
	}

	// カウンター編集ダイアログを表示する
	private async showCounterEditDialog({triggerId}: {triggerId: string}) {
		log.info('Showing counter edit dialog');

		await this.#slack.views.open({
			trigger_id: triggerId,
			view: counterEditDialog(this.#state),
		});
	}
}
