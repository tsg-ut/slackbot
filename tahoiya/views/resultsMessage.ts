import type {KnownBlock} from '@slack/web-api';
import type {Betting, RatingChange, ShuffledMeaning, Theme} from '../types';
import {getWordUrl, SOURCE_LABELS} from '../utils';

const themeTitle = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `「${theme.word}」（${theme.ruby}）`;
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
		return '（ダミー）';
	}
	const [word, , source, , id] = m.dummyWord;
	const url = getWordUrl(word, source as any, id);
	const label = SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source;
	return `（ダミー: <${url}|${word} - ${label}>）`;
};

const formatDelta = (delta: number): string => {
	const rounded = Math.round(delta);
	return rounded >= 0 ? `+${rounded}` : `${rounded}`;
};

export default (
	theme: Theme,
	shuffledMeanings: ShuffledMeaning[],
	bettings: Record<string, Betting>,
	ratingChanges: RatingChange[],
	correctMeaningIndex: number,
): KnownBlock[] => {
	const correctBetters = Object.entries(bettings).filter(
		([, b]) => b.meaningIndex === correctMeaningIndex,
	);
	const incorrectBetters = Object.entries(bettings).filter(
		([, b]) => b.meaningIndex !== correctMeaningIndex,
	);

	const correctText = correctBetters.filter(([u]) => u.startsWith('U')).length > 0
		? correctBetters.filter(([u]) => u.startsWith('U')).map(([u]) => `<@${u}>`).join(' ')
		: 'なし';
	const incorrectText = incorrectBetters.filter(([u]) => u.startsWith('U')).length > 0
		? incorrectBetters.filter(([u]) => u.startsWith('U')).map(([u]) => `<@${u}>`).join(' ')
		: 'なし';

	const meaningDetails = shuffledMeanings.map((m, i) => {
		const bettersForThis = Object.entries(bettings)
			.filter(([, b]) => b.meaningIndex === i)
			.map(([u, b]) => `<@${u}>(${b.coins}枚)`)
			.join(' ');

		let typeIcon = '👤';
		let attribution = `（<@${m.userId}>の意味）`;
		if (m.isCorrect) {
			typeIcon = '✅';
			attribution = '（正解）';
		} else if (m.isDummy) {
			typeIcon = '🤖';
			attribution = dummyAttribution(m);
		}

		return `${i + 1}. ${typeIcon} ${m.text} ${attribution}\n   → ${bettersForThis || 'ベットなし'}`;
	}).join('\n\n');

	const ratingText = ratingChanges.length > 0
		? ratingChanges
			.map((r) => `<@${r.userId}>: ${Math.round(r.oldRating)} → ${Math.round(r.newRating)} (${formatDelta(r.delta)})`)
			.join('\n')
		: null;

	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {type: 'plain_text', text: 'たほいや 結果発表！', emoji: true},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `正解: ${themeTitle(theme)} = *${themeAnswer(theme)}*\n出典: ${themeSource(theme)}`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `:tada: 正解者: ${correctText}\n:disappointed: 外した人: ${incorrectText}`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*意味の内訳:*\n${meaningDetails}`,
			},
		},
	];

	if (ratingText) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*レーティング変動:*\n${ratingText}`,
			},
		});
	}

	return blocks;
};
