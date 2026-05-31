import type {KnownBlock} from '@slack/web-api';
import type {DailyGameState, Theme} from '../types';

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

export default (game: DailyGameState | null, themeStockCount = 0): KnownBlock[] => {
	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {type: 'plain_text', text: 'デイリーたほいや', emoji: true},
		},
	];

	if (game === null) {
		blocks.push({
			type: 'section',
			text: {type: 'mrkdwn', text: '本日のお題はまだ決まっていません。お題を登録して参加しましょう！'},
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

	blocks.push({
		type: 'context',
		elements: [{
			type: 'mrkdwn',
			text: `お題ストック: ${themeStockCount}件`,
		}],
	});

	blocks.push({type: 'divider'});

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

	return blocks;
};
