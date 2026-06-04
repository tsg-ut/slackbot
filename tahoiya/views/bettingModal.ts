import type {View} from '@slack/web-api';
import type {ShuffledMeaning} from '../types';

export default (shuffledMeanings: ShuffledMeaning[], gameType: 'normal' | 'daily', userId: string): View => {
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
		],
	};
};
