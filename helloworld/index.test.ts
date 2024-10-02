/* eslint-disable import/imports-first, import/first */
/* eslint-env jest */

jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
jest.mock('os', () => ({
	hostname: () => 'test-hostname',
	release: () => 'test-release',
}));
jest.mock('crypto', () => ({
	randomUUID: () => 'test-uuid',
}));


import type {MockedStateInterface} from '../lib/__mocks__/state';
import Slack from '../lib/slackMock';
import State from '../lib/state';
import {HelloWorld, type StateObj} from '.';

let slack: Slack = null;
let helloWorld: HelloWorld = null;

const MockedState = State as MockedStateInterface<StateObj>;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;

	helloWorld = await HelloWorld.create(slack);
});

describe('helloworld', () => {
	it('can post Hello world message', async () => {
		const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		postMessage.mockResolvedValueOnce({
			ok: true,
			ts: slack.fakeTimestamp,
			channel: slack.fakeChannel,
		});

		await helloWorld.postHelloWorld();

		const state = MockedState.mocks.get('helloworld');
		expect(state.counter).toBe(0);
		expect(state.uuid).toBe('test-uuid');
		expect(state.latestStatusMessage).toEqual({
			ts: slack.fakeTimestamp,
			channel: slack.fakeChannel,
		});

		const mockedPostMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
		expect(mockedPostMessage).toBeCalledWith({
			username: 'helloworld [test-hostname]',
			channel: slack.fakeChannel,
			text: 'Hello, World!',
			blocks: [
				{
					type: 'header',
					text: {
						type: 'plain_text',
						text: 'Hello, World!',
						emoji: true,
					},
				},
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: 'おめでとうございます、TSGのSlackbotの開発環境のセットアップが完了しました! :tada::tada::tada:\n以下のボタンをクリックして、Event API が正常に動作しているか確認してください。',
					},
				},
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: '現在のカウンター: ＊0＊',
					},
				},
				{
					type: 'actions',
					elements: [
						{
							type: 'button',
							text: {
								type: 'plain_text',
								text: '+1',
								emoji: true,
							},
							action_id: 'helloworld_test-uuid_increment_1_button',
						},
						{
							type: 'button',
							text: {
								type: 'plain_text',
								text: '編集する',
								emoji: true,
							},
							action_id: 'helloworld_test-uuid_edit_button',
						},
					],
				},
				{
					type: 'context',
					elements: [
						{
							type: 'plain_text',
							text: '⚠この値は再起動後も保存されますが、再起動前に投稿されたメッセージの数字は更新されなくなります。ボタンを押すとエラーが出る場合は、「Slackbotを作ろう」ページの「WebSocketトンネルをセットアップする」などを参考に Event API のセットアップが正常にできているかもう一度確認してください。',
							emoji: true,
						},
					],
				},
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: 'このBOTは、Slackbot開発時のみ使用されるBOTで、本番環境では無効化されています。このBOTはSlackbotの動作確認に使えるほか、新しいBOTを開発する際の雛形として利用することもできます。',
					},
				},
			],
		});
	});
});

