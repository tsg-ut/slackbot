import type {View} from '@slack/web-api';
import type {GameComment, ShuffledMeaning} from '../types';

export default (shuffledMeanings: ShuffledMeaning[], gameType: 'normal' | 'daily', userId: string, userComments: GameComment[] = []): View => {
	const votableMeanings = shuffledMeanings
		.map((m, i) => ({m, i}))
		.filter(({m}) => m.userId !== userId);

	return {
		type: 'modal',
		callback_id: gameType === 'normal' ? 'tahoiya_normal_bet_modal' : 'tahoiya_daily_bet_modal',
		title: {type: 'plain_text', text: '投票する'},
		submit: {type: 'plain_text', text: '投票する'},
		blocks: [
			{
				type: 'input',
				block_id: 'meaning_select',
				label: {type: 'plain_text', text: '正しいと思う意味を選んでください'},
				element: {
					type: 'static_select',
					action_id: 'meaning_index',
					placeholder: {type: 'plain_text', text: '意味を選択'},
					options: votableMeanings.map(({m, i}) => ({
						text: {
							type: 'plain_text' as const,
							text: `${i + 1}. ${m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text}`,
						},
						value: String(i),
					})),
				},
			},
			{type: 'divider'},
			...(userComments.length > 0 ? [{
				type: 'section' as const,
				text: {
					type: 'mrkdwn' as const,
					text: `*あなたのコメント:*\n${userComments.map((c) => `> ${c.text}`).join('\n')}`,
				},
			}] : []),
			{
				type: 'input',
				block_id: 'comment_input',
				optional: true,
				label: {type: 'plain_text', text: 'コメント（ゲーム終了まで非公開）'},
				element: {
					type: 'plain_text_input',
					action_id: 'comment_text',
					multiline: true,
					max_length: 500,
					placeholder: {type: 'plain_text', text: 'ゲームについてのコメントを入力...'},
				},
			},
			{
				type: 'actions',
				block_id: 'comment_actions',
				elements: [{
					type: 'button',
					action_id: `tahoiya_${gameType}_comment_button`,
					text: {type: 'plain_text', text: 'コメントを送信', emoji: true},
				}],
			},
		],
	};
};
