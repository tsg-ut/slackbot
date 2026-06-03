import type {View} from '@slack/web-api';
import type {ShuffledMeaning} from '../types';

export default (shuffledMeanings: ShuffledMeaning[], gameType: 'normal' | 'daily', userId: string, humanCount: number): View => {
	const votableMeanings = shuffledMeanings
		.map((m, i) => ({m, i}))
		.filter(({m}) => m.userId !== userId);

	const maxCoins = Math.max(1, Math.min(5, humanCount));

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
			{
				type: 'input',
				block_id: 'coins_input',
				label: {type: 'plain_text', text: `BET枚数（1〜${maxCoins}枚）`},
				element: {
					type: 'number_input',
					action_id: 'coins',
					is_decimal_allowed: false,
					min_value: '1',
					max_value: String(maxCoins),
					placeholder: {type: 'plain_text', text: '枚数を入力'},
				},
			},
		],
	};
};
