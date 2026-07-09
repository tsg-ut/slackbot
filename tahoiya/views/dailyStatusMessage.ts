import type {KnownBlock} from '@slack/web-api';
import type {DailyGameState, Theme} from '../types.js';

const themeLabel = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `*${theme.ruby}*`;
	}
	return `*${theme.question}*`;
};

const phaseLabel = (game: DailyGameState): string => {
	if (game.phase === 'collect_bettings') {
		const remaining = Math.max(0, game.endPhaseAt - Date.now());
		const minutes = Math.floor(remaining / 60000);
		return `投票受付中 (残り約${minutes}分)`;
	}
	const meaningCount = Object.keys(game.meanings).filter((u) => u.startsWith('U')).length;
	return `意味提出者: ${meaningCount}人`;
};

export default (game: DailyGameState | null, themeStockCount: number, skipNotice: string | null): KnownBlock[] => {
	const blocks: KnownBlock[] = [];

	if (skipNotice !== null) {
		blocks.push(
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: skipNotice,
				},
			},
			{
				type: 'divider',
			},
		);
	}

	if (game === null) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: '現在、デイリーたほいやは開催されていません。',
			},
		});
	} else {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `本日のお題: ${themeLabel(game.theme)}\n${phaseLabel(game)}`,
			},
		});
	}

	const actionElements: {type: 'button'; text: {type: 'plain_text'; text: string; emoji: boolean}; action_id: string; style?: 'primary' | 'danger'}[] = [];

	if (game !== null && game.phase === 'collect_meanings') {
		actionElements.push({
			type: 'button',
			text: {type: 'plain_text', text: '意味を登録する', emoji: true},
			action_id: 'tahoiya_daily_submit_meaning_button',
			style: 'primary',
		});
	}

	if (game !== null && game.phase === 'collect_bettings') {
		actionElements.push({
			type: 'button',
			text: {type: 'plain_text', text: '投票する', emoji: true},
			action_id: 'tahoiya_daily_bet_button',
			style: 'primary',
		});
	}

	actionElements.push({
		type: 'button',
		text: {type: 'plain_text', text: 'お題を登録する', emoji: true},
		action_id: 'tahoiya_register_theme_button',
	});

	blocks.push({
		type: 'actions',
		elements: actionElements,
	});

	blocks.push({
		type: 'context',
		elements: [{
			type: 'mrkdwn',
			text: `お題ストック: ${themeStockCount}件`,
		}],
	});

	return blocks;
};
