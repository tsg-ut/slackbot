import type {KnownBlock} from '@slack/web-api';
import {chunk} from 'lodash-es';
import type {WordEntry} from '../../lib/candidateWords.js';

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

	const actionChunks = chunk(buttons, 5);

	const blocks: KnownBlock[] = [
		{
			type: 'section',
			text: {type: 'mrkdwn', text: 'お題を選んでください（押したらゲーム開始）'},
		},
		...actionChunks.map((buttonGroup): KnownBlock => ({
			type: 'actions',
			elements: buttonGroup,
		})),
	];

	return blocks;
};
