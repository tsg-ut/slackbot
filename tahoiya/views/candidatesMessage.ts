import type {KnownBlock} from '@slack/web-api';
import type {WordEntry} from '../../lib/candidateWords';

export default (candidates: WordEntry[]): KnownBlock[] => {
	const buttons = candidates.map((word): {type: 'button'; text: {type: 'plain_text'; text: string; emoji: boolean}; action_id: string; value: string} => ({
		type: 'button',
		text: {
			type: 'plain_text',
			text: word[1],
			emoji: true,
		},
		action_id: `tahoiya_select_theme_${word[1]}`,
		value: word[1],
	}));

	const actionChunks: {type: 'button'; text: {type: 'plain_text'; text: string; emoji: boolean}; action_id: string; value: string}[][] = [];
	for (let i = 0; i < buttons.length; i += 5) {
		actionChunks.push(buttons.slice(i, i + 5));
	}

	const blocks: KnownBlock[] = [
		{
			type: 'section',
			text: {type: 'mrkdwn', text: 'お題を選んでください（押したらゲーム開始）'},
		},
		...actionChunks.map((chunk): KnownBlock => ({
			type: 'actions',
			elements: chunk,
		})),
	];

	return blocks;
};
