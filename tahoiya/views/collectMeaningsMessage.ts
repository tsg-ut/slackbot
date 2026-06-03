import type {KnownBlock} from '@slack/web-api';
import type {DailyGameState, NormalGameState, Theme} from '../types';

const formatTime = (ts: number): string => {
	const d = new Date(ts);
	const h = d.getHours().toString().padStart(2, '0');
	const m = d.getMinutes().toString().padStart(2, '0');
	const s = d.getSeconds().toString().padStart(2, '0');
	return `${h}:${m}:${s}`;
};

// Display only the ruby (reading), not the word itself
const themeRuby = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return theme.ruby;
	}
	return theme.question;
};

const themePrompt = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `「＊${theme.ruby}＊」の意味を考えてください`;
	}
	return `「＊${theme.question}＊」を考えてください`;
};

export default (
	game: NormalGameState | DailyGameState,
	gameType: 'normal' | 'daily',
	disabled = false,
): KnownBlock[] => {
	const theme = game.theme!;
	const remainingMs = Math.max(0, game.endPhaseAt - Date.now());
	const remainingMins = Math.ceil(remainingMs / 60000);

	const humanMeaningUsers = Object.keys(game.meanings).filter((u) => u.startsWith('U'));
	const submittedText = humanMeaningUsers.length > 0
		? `${humanMeaningUsers.map((u) => `<@${u}>`).join(' ')} (${humanMeaningUsers.length}人)`
		: 'まだ誰も登録していません';

	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '楽しい「たほいや」を始めるよ～',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: themePrompt(theme),
			},
		},
		{
			type: 'context',
			elements: [
				{
					type: 'mrkdwn',
					text: disabled
						? `提出期限: ${formatTime(game.endPhaseAt)} | 登録済み: ${submittedText}`
						: `提出期限: *${formatTime(game.endPhaseAt)}* まで (残り約${remainingMins}分) | 登録済み: ${submittedText}`,
				},
			],
		},
	];

	if (!disabled) {
		blocks.push({
			type: 'actions',
			elements: [
				{
					type: 'button',
					text: {type: 'plain_text', text: '意味を登録する', emoji: true},
					action_id: gameType === 'normal' ? 'tahoiya_normal_submit_meaning_button' : 'tahoiya_daily_submit_meaning_button',
					style: 'primary',
				},
			],
		});
	}

	return blocks;
};
