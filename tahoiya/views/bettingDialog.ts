import type {View} from '@slack/web-api';
import type {ShuffledMeaning} from '../types';

const colors = [
	'#F44336',
	'#7E57C2',
	'#0288D1',
	'#388E3C',
	'#F4511E',
	'#607D8B',
	'#EC407A',
	'#5C6BC0',
	'#00838F',
	'#558B2F',
	'#8D6E63',
	'#AB47BC',
	'#1E88E5',
	'#009688',
	'#827717',
	'#E65100',
];

export default (gameId: string, themeRuby: string, shuffledMeanings: ShuffledMeaning[], userId: string, humanCount: number): View => ({
	type: 'modal',
	callback_id: `tahoiya_betting_${gameId}`,
	title: {
		text: 'たほいや - ベッティング',
		type: 'plain_text',
	},
	submit: {
		text: 'ベット',
		type: 'plain_text',
	},
	close: {
		text: 'キャンセル',
		type: 'plain_text',
	},
	private_metadata: gameId,
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*「${themeRuby}」* の正しい意味だと思うものを選んでベットしてください`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: shuffledMeanings.map((meaning, index) => {
					if (meaning.user === userId) {
						return `~${index + 1}. ${meaning.text}~（あなたの回答）`;
					}
					return `${index + 1}. ${meaning.text}`;
				}).join('\n\n'),
			},
		},
		{
			type: 'input',
			block_id: 'meaning_selection',
			element: {
				type: 'static_select',
				action_id: 'meaning_select',
				placeholder: {
					type: 'plain_text',
					text: '正しいと思う意味を選択...',
				},
				options: shuffledMeanings
					.map((meaning, index) => ({
						text: {
							type: 'plain_text' as const,
							text: `${index + 1}. ${meaning.text.substring(0, 50)}${meaning.text.length > 50 ? '...' : ''}`,
						},
						value: index.toString(),
					}))
					.filter((_, index) => shuffledMeanings[index].user !== userId),
			},
			label: {
				type: 'plain_text',
				text: '選択',
			},
		},
		{
			type: 'input',
			block_id: 'coins_input',
			element: {
				type: 'static_select',
				action_id: 'coins_select',
				placeholder: {
					type: 'plain_text',
					text: 'ベット枚数を選択...',
				},
				options: Array.from({length: Math.min(5, humanCount)}, (_, i) => ({
					text: {
						type: 'plain_text' as const,
						text: `${i + 1}枚`,
					},
					value: (i + 1).toString(),
				})),
			},
			label: {
				type: 'plain_text',
				text: 'ベット枚数',
			},
		},
	],
});