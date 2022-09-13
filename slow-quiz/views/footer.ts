import type {KnownBlock} from '@slack/web-api';

export default [
	{
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: '*1日1文字クイズ ルール*\n\n● 1問につき1日1回のみ回答することができます。\n● 回答するために検索や調査を行うのはOKです。\n● 正解者が3人出たら終了します。',
		},
	},
	{
		type: 'actions',
		elements: [
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: '問題を登録する',
					emoji: true,
				},
				style: 'primary',
				action_id: 'slowquiz_register_quiz_button',
			},
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: '登録した問題を見る',
					emoji: true,
				},
				action_id: 'slowquiz_list_quiz_button',
			},
		],
	},
] as KnownBlock[];
