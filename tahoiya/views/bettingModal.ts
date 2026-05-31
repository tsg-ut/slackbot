import type {View} from '@slack/web-api';
import type {ShuffledMeaning} from '../types';

export default (shuffledMeanings: ShuffledMeaning[], gameType: 'normal' | 'daily'): View => ({
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
				options: shuffledMeanings.map((m, i) => ({
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
			label: {type: 'plain_text', text: 'ベット枚数（1〜5枚、参加者数以下）'},
			element: {
				type: 'number_input',
				action_id: 'coins',
				is_decimal_allowed: false,
				min_value: '1',
				max_value: String(Math.min(5, shuffledMeanings.filter((m) => !m.isCorrect).length)),
				placeholder: {type: 'plain_text', text: '枚数を入力'},
			},
		},
	],
});
