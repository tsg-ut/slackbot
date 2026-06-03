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
	return `（<${url}|${word} - ${label}>）`;
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
		let attribution = `（<@${m.userId}>）`;
		if (m.isCorrect) {
			typeIcon = '✅';
			attribution = '（正解）';
		} else if (m.isDummy) {
			typeIcon = '🤖';
			attribution = dummyAttribution(m);
		}

		return `${i + 1}. ${typeIcon} ${m.text} ${attribution}\n   → ${bettersForThis || 'BETなし'}`;
	}).join('\n\n');

	const ratingText = ratingChanges.length > 0
		? ratingChanges
			.map(({userId, oldRating, newRating, delta}) => (
				`<@${userId}>: ${Math.round(oldRating)} → ${Math.round(newRating)} (${formatDelta(delta)})`
			))
			.join('\n')
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
				text: `${themeTitle(theme)}\n意味: *${themeAnswer(theme)}*\n出典: ${themeSource(theme)}`,
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
