import type {KnownBlock} from '@slack/web-api';
import type {DailyGameState, NormalGameState, Theme} from '../types.js';

const formatTime = (ts: number): string => {
	const d = new Date(ts);
	const h = d.getHours().toString().padStart(2, '0');
	const m = d.getMinutes().toString().padStart(2, '0');
	const s = d.getSeconds().toString().padStart(2, '0');
	return `${h}:${m}:${s}`;
};

const themeQuestion = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `「${theme.ruby}」の正しい意味はどれでしょう？`;
	}
	return theme.question;
};

export default (
	game: NormalGameState | DailyGameState,
	gameType: 'normal' | 'daily',
	disabled = false,
): KnownBlock[] => {
	const theme = game.theme!;
	const remainingMs = Math.max(0, game.endPhaseAt - Date.now());
	const remainingMins = Math.ceil(remainingMs / 60000);

	const meaningLines = game.shuffledMeanings
		.map((m, i) => `${i + 1}. ${m.text}`)
		.join('\n');

	const meaningUsers = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
	const participantText = meaningUsers.length > 0
		? meaningUsers.map((u) => `<@${u}>`).join(' ')
		: null;

	const bettingUsers = Object.keys(game.votes).filter((u) => u.startsWith('U'));
	const bettingText = bettingUsers.length > 0
		? `投票済み: ${bettingUsers.map((u) => `<@${u}>`).join(' ')} (${bettingUsers.length}人)`
		: 'まだ誰も投票していません';

	const deadlineText = disabled
		? `投票期限: ${formatTime(game.endPhaseAt)}`
		: `投票期限: *${formatTime(game.endPhaseAt)}* まで (残り約${remainingMins}分)`;

	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: `たほいや 投票フェーズ\n${themeQuestion(theme)}`,
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `${deadlineText}\n\n${meaningLines}`,
			},
		},
	];

	const themeAuthor = 'themeAuthor' in game ? (game as DailyGameState).themeAuthor : null;
	if (themeAuthor) {
		blocks.push({
			type: 'section',
			text: {type: 'mrkdwn', text: `出題者: <@${themeAuthor}>`},
		});
	}

	if (participantText) {
		blocks.push({
			type: 'section',
			text: {type: 'mrkdwn', text: `意味登録者: ${participantText}`},
		});
	}

	if (!disabled) {
		blocks.push({
			type: 'actions',
			elements: [
				{
					type: 'button',
					text: {type: 'plain_text', text: '投票する', emoji: true},
					action_id: gameType === 'normal' ? 'tahoiya_normal_bet_button' : 'tahoiya_daily_bet_button',
					style: 'primary',
				},
			],
		});
	}

	blocks.push({
		type: 'context',
		elements: [{type: 'mrkdwn', text: bettingText}],
	});

	return blocks;
};
