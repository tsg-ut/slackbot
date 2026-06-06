import type {KnownBlock} from '@slack/web-api';
import type {RatingChange, ShuffledMeaning, Theme, DictionarySource} from '../types';
import {getWordUrl, SOURCE_LABELS} from '../utils';

const themeTitle = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `${theme.word} （${theme.ruby}）`;
	}
	return `「${theme.question}」`;
};

const themeAnswer = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return theme.meaning;
	}
	return theme.answer;
};

const themeSource = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `<${theme.sourceUrl}|${theme.sourceString}>`;
	}
	return `<${theme.sourceUrl}|参照>`;
};

const dummyAttribution = (m: ShuffledMeaning): string => {
	if (!m.dummyWord) {
		return `（${m.userId}）`;
	}
	const [word, , source, , id] = m.dummyWord;
	const url = getWordUrl(word, source as DictionarySource, id);
	const label = SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source;
	return `（<${url}|${word} - ${label}>）`;
};

const formatDelta = (delta: number): string => {
	const rounded = Math.round(delta);
	return rounded >= 0 ? `+${rounded}` : `${rounded}`;
};

export default (
	theme: Theme,
	shuffledMeanings: ShuffledMeaning[],
	votes: Record<string, number>,
	ratingChanges: RatingChange[],
	correctMeaningIndex: number,
	playerScores: Record<string, number>,
): KnownBlock[] => {
	const correctVoters = Object.entries(votes).filter(([, idx]) => idx === correctMeaningIndex);
	const incorrectVoters = Object.entries(votes).filter(([, idx]) => idx !== correctMeaningIndex);

	const correctText = correctVoters.filter(([u]) => u.startsWith('U')).length > 0
		? correctVoters.filter(([u]) => u.startsWith('U')).map(([u]) => `<@${u}>`).join(' ')
		: 'なし';
	const incorrectText = incorrectVoters.filter(([u]) => u.startsWith('U')).length > 0
		? incorrectVoters.filter(([u]) => u.startsWith('U')).map(([u]) => `<@${u}>`).join(' ')
		: 'なし';

	const meaningDetails = shuffledMeanings.map((m, i) => {
		const votersForThis = Object.entries(votes)
			.filter(([, idx]) => idx === i)
			.map(([u]) => `<@${u}>`)
			.join(' ');

		let typeIcon = '👤';
		let attribution = `（<@${m.userId}>）`;
		if (m.isCorrect) {
			typeIcon = '✅';
			attribution = '（正解）';
		} else if (m.isDummy) {
			typeIcon = '🤖';
			attribution = dummyAttribution(m);
		}

		return `${i + 1}. ${typeIcon} ${m.text} ${attribution}\n   → ${votersForThis || '投票なし'}`;
	}).join('\n\n');

	const sortedPlayers = Object.entries(playerScores)
		.filter(([u]) => u.startsWith('U'))
		.sort(([, a], [, b]) => b - a);

	const ratingByUser = new Map(ratingChanges.map((r) => [r.userId, r]));

	const playerText = sortedPlayers.length > 0
		? sortedPlayers.map(([userId, score]) => {
			const rating = ratingByUser.get(userId);
			const ratingText = rating
				? ` | ${Math.round(rating.oldRating)} → ${Math.round(rating.newRating)} (${formatDelta(rating.delta)})`
				: '';
			return `<@${userId}>: ${score}点${ratingText}`;
		}).join('\n')
		: null;

	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {type: 'plain_text', text: '結果発表～', emoji: true},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: [
					themeTitle(theme),
					`${theme.type === 'dictionary' ? '正しい意味' : '正解'}: *${themeAnswer(theme)}*`,
					`出典: ${themeSource(theme)}`,
				].join('\n'),
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `:tada: 正解者: ${correctText}\n:disappointed: 不正解者: ${incorrectText}`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: meaningDetails,
			},
		},
	];

	if (playerText) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*スコア・レーティング変動:*\n${playerText}`,
			},
		});
	}

	return blocks;
};
