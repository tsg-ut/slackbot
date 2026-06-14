import {OLD_PROVINCE_NAMES} from './oldProvinces';

// Reading of each prefecture in hiragana (without 県/府/都/道)
const PREFECTURE_BASE_READINGS: Record<string, string> = {
	北海道: 'ほっかいどう',
	青森県: 'あおもり',
	岩手県: 'いわて',
	秋田県: 'あきた',
	宮城県: 'みやぎ',
	山形県: 'やまがた',
	福島県: 'ふくしま',
	東京都: 'とうきょう',
	神奈川県: 'かながわ',
	千葉県: 'ちば',
	埼玉県: 'さいたま',
	茨城県: 'いばらき',
	栃木県: 'とちぎ',
	群馬県: 'ぐんま',
	山梨県: 'やまなし',
	長野県: 'ながの',
	石川県: 'いしかわ',
	新潟県: 'にいがた',
	富山県: 'とやま',
	福井県: 'ふくい',
	愛知県: 'あいち',
	静岡県: 'しずおか',
	岐阜県: 'ぎふ',
	三重県: 'みえ',
	大阪府: 'おおさか',
	兵庫県: 'ひょうご',
	京都府: 'きょうと',
	滋賀県: 'しが',
	奈良県: 'なら',
	和歌山県: 'わかやま',
	愛媛県: 'えひめ',
	香川県: 'かがわ',
	高知県: 'こうち',
	徳島県: 'とくしま',
	岡山県: 'おかやま',
	広島県: 'ひろしま',
	島根県: 'しまね',
	鳥取県: 'とっとり',
	山口県: 'やまぐち',
	福岡県: 'ふくおか',
	佐賀県: 'さが',
	長崎県: 'ながさき',
	熊本県: 'くまもと',
	大分県: 'おおいた',
	宮崎県: 'みやざき',
	鹿児島県: 'かごしま',
	沖縄県: 'おきなわ',
};

const PREFECTURE_SUFFIX_READINGS: Record<string, string> = {
	北海道: '',
	東京都: 'と',
	大阪府: 'ふ',
	京都府: 'ふ',
};

const hiraganaToKatakana = (str: string): string =>
	str.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// Strips suffix (県/府/都/道) from prefecture name
const stripSuffix = (prefName: string): string =>
	prefName.replace(/[都道府県]$/, '');

export function getCorrectAnswers(prefName: string): string[] {
	const baseReading = PREFECTURE_BASE_READINGS[prefName];
	if (!baseReading) return [prefName];

	const suffixReading = PREFECTURE_SUFFIX_READINGS[prefName] ?? 'けん';
	const fullReading = baseReading + suffixReading;
	const shortName = stripSuffix(prefName);

	const answers = [
		prefName,
		shortName,
		fullReading,
		baseReading,
		hiraganaToKatakana(fullReading),
		hiraganaToKatakana(baseReading),
	];

	// Deduplicate while preserving order
	return [...new Set(answers)];
}

// All valid prefecture answers across all 47 prefectures
const ALL_VALID_ANSWERS: Set<string> = new Set(
	Object.keys(PREFECTURE_BASE_READINGS).flatMap((prefName) =>
		getCorrectAnswers(prefName).map((a) => a.toLowerCase()),
	),
);

export function isValidPrefectureAnswer(answer: string): boolean {
	return ALL_VALID_ANSWERS.has(answer.toLowerCase().trim());
}

export function maskAnswers(hint: string, prefName: string, municipalities: string[] = []): string {
	const correctAnswers = getCorrectAnswers(prefName);
	const oldProvinces = OLD_PROVINCE_NAMES[prefName] ?? [];

	// For each municipality (e.g. 札幌市), also mask the base name (e.g. 札幌) if >= 2 chars
	const municipalityVariants = municipalities.flatMap((m) => {
		const base = m.replace(/[市区町村]$/, '');
		return base.length >= 2 ? [m, base] : [m];
	});

	// Sort longest first to avoid partial replacements
	const toMask = [...new Set([...correctAnswers, ...oldProvinces, ...municipalityVariants])]
		.sort((a, b) => b.length - a.length);

	let result = hint;
	for (const mask of toMask) {
		result = result.replaceAll(mask, '〇〇');
	}
	return result;
}
