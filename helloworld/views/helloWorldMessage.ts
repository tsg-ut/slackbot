import type {KnownBlock} from '@slack/web-api';
import type {StateObj} from '../HelloWorld';

export default (state: StateObj): KnownBlock[] => [
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
			text: `現在のカウンター: ＊${state.counter}＊`,
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
				// Helloworld BOT のボタンは複数の環境から押される可能性があるため、UUIDを用いてボタンの識別を行っています。
				// Helloworld BOT 以外のBOTを開発する際には、このような識別子を用いる必要はありません。
				action_id: `helloworld_${state.uuid}_increment_1_button`,
			},
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: '編集する',
					emoji: true,
				},
				action_id: `helloworld_${state.uuid}_edit_button`,
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
];
