import qs from 'querystring';
import {z} from 'zod';
import logger from '../lib/logger';
import {type PrefectureKanji, prefectures} from '../room-gacha/prefectures';

const log = logger.child({bot: 'city-symbol/common'});

export const WIKIPEDIA_USER_AGENT = 'TSGSlackbot/1.0 (https://github.com/hakatashi/slackbot; contact@hakatashi.com)';

export const MediaWikiRevisionsResponseSchema = z.object({
	query: z.object({
		pages: z.record(z.object({
			revisions: z.array(z.object({
				'*': z.string(),
			})).min(1),
		})),
	}),
});

export const MediaWikiExtractResponseSchema = z.object({
	query: z.object({
		pages: z.record(z.object({
			extract: z.string(),
		})),
	}),
});

export const extractWikipediaPlaintext = (content: string): string => {
	const normalizedContent = content
		.replaceAll(/<ref[^/>]*>.*?<\/ref>/g, '')
		.replaceAll(/<ref[^>]*\/>/g, '')
		.replaceAll(/\[\[(?:File|Image|ファイル):[^\]]+\]\]/gi, '')
		.replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replaceAll(/\[\[([^\]]+)\]\]/g, '$1')
		.replaceAll(/^\|/g, '')
		.replaceAll(/\{\{.*?\}\}/g, '')
		.trim();
	return normalizedContent;
};

export const getPlaintextWikipedia = async (title: string): Promise<string> => {
	log.info(`Getting wikipedia plaintext for ${title}...`);

	const url = `https://ja.wikipedia.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'extracts',
		explaintext: true,
		titles: title,
	})}`;

	const response = await fetch(url, {
		headers: {
			'User-Agent': WIKIPEDIA_USER_AGENT,
		},
	});
	const json = await response.json();
	const {query: {pages}} = MediaWikiExtractResponseSchema.parse(json);

	const content = Object.values(pages)[0].extract;
	return content;
};

export const getWikimediaImageUrl = (fileName: string): string => {
	if (fileName.startsWith('http')) {
		return fileName;
	}
	return `https://commons.wikimedia.org/wiki/Special:FilePath/${qs.escape(fileName)}?width=400`;
};

export interface PrefectureMeta {
	kanji: PrefectureKanji;
	hiragana: string;
	romaji: string;
}

export const prefectureMetaList: Record<PrefectureKanji, {hiragana: string, romaji: string}> = {
	北海道: {hiragana: 'ほっかいどう', romaji: 'hokkaido'},
	青森県: {hiragana: 'あおもり', romaji: 'aomori'},
	岩手県: {hiragana: 'いわて', romaji: 'iwate'},
	宮城県: {hiragana: 'みやぎ', romaji: 'miyagi'},
	秋田県: {hiragana: 'あきた', romaji: 'akita'},
	山形県: {hiragana: 'やまがた', romaji: 'yamagata'},
	福島県: {hiragana: 'ふくしま', romaji: 'fukushima'},
	茨城県: {hiragana: 'いばらき', romaji: 'ibaraki'},
	栃木県: {hiragana: 'とちぎ', romaji: 'tochigi'},
	群馬県: {hiragana: 'ぐんま', romaji: 'gunma'},
	埼玉県: {hiragana: 'さいたま', romaji: 'saitama'},
	千葉県: {hiragana: 'ちば', romaji: 'chiba'},
	東京都: {hiragana: 'とうきょう', romaji: 'tokyo'},
	神奈川県: {hiragana: 'かながわ', romaji: 'kanagawa'},
	新潟県: {hiragana: 'にいがた', romaji: 'niigata'},
	富山県: {hiragana: 'とやま', romaji: 'toyama'},
	石川県: {hiragana: 'いしかわ', romaji: 'ishikawa'},
	福井県: {hiragana: 'ふくい', romaji: 'fukui'},
	山梨県: {hiragana: 'やまなし', romaji: 'yamanashi'},
	長野県: {hiragana: 'ながの', romaji: 'nagano'},
	岐阜県: {hiragana: 'ぎふ', romaji: 'gifu'},
	静岡県: {hiragana: 'しずおか', romaji: 'shizuoka'},
	愛知県: {hiragana: 'あいち', romaji: 'aichi'},
	三重県: {hiragana: 'みえ', romaji: 'mie'},
	滋賀県: {hiragana: 'しが', romaji: 'shiga'},
	京都府: {hiragana: 'きょうと', romaji: 'kyoto'},
	大阪府: {hiragana: 'おおさか', romaji: 'osaka'},
	兵庫県: {hiragana: 'ひょうご', romaji: 'hyogo'},
	奈良県: {hiragana: 'なら', romaji: 'nara'},
	和歌山県: {hiragana: 'わかやま', romaji: 'wakayama'},
	鳥取県: {hiragana: 'とっとり', romaji: 'tottori'},
	島根県: {hiragana: 'しまね', romaji: 'shimane'},
	岡山県: {hiragana: 'おかやま', romaji: 'okayama'},
	広島県: {hiragana: 'ひろしま', romaji: 'hiroshima'},
	山口県: {hiragana: 'やまぐち', romaji: 'yamaguchi'},
	徳島県: {hiragana: 'とくしま', romaji: 'tokushima'},
	香川県: {hiragana: 'かがわ', romaji: 'kagawa'},
	愛媛県: {hiragana: 'えひめ', romaji: 'ehime'},
	高知県: {hiragana: 'こうち', romaji: 'kochi'},
	福岡県: {hiragana: 'ふくおか', romaji: 'fukuoka'},
	佐賀県: {hiragana: 'さが', romaji: 'saga'},
	長崎県: {hiragana: 'ながさき', romaji: 'nagasaki'},
	熊本県: {hiragana: 'くまもと', romaji: 'kumamoto'},
	大分県: {hiragana: 'おおいた', romaji: 'oita'},
	宮崎県: {hiragana: 'みやざき', romaji: 'miyazaki'},
	鹿児島県: {hiragana: 'かごしま', romaji: 'kagoshima'},
	沖縄県: {hiragana: 'おきなわ', romaji: 'okinawa'},
};

// 全角カタカナをひらがなに変換
export const katakanaToHiragana = (str: string): string => {
	return str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
};

// 全角英数を半角英数に変換
export const fullWidthToHalfWidth = (str: string): string => {
	return str.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
};

// 入力文字列を正規化
export const normalizeAnswerString = (str: string): string => {
	let normalized = str.trim();
	normalized = fullWidthToHalfWidth(normalized);
	normalized = katakanaToHiragana(normalized);
	normalized = normalized.toLowerCase();
	normalized = normalized.replace(/\s+/g, '');
	return normalized;
};

// 都道府県名とその別名マッピング（normalized string -> PrefectureKanji）
const prefectureLookupMap = new Map<string, PrefectureKanji>();

for (const [prefKanji, meta] of Object.entries(prefectureMetaList) as [PrefectureKanji, {hiragana: string, romaji: string}][]) {
	const suffix = prefKanji.slice(-1); // 都, 道, 府, 県
	const stem = prefKanji.slice(0, -1); // 滋賀, 東京, etc. (北海道の場合は stem = 北海 だが北海道は特別扱い)

	// 漢字
	prefectureLookupMap.set(prefKanji, prefKanji);
	if (prefKanji !== '北海道') {
		prefectureLookupMap.set(stem, prefKanji);
	}

	// ひらがな
	const hSuffix = suffix === '都' ? 'と' : suffix === '府' ? 'ふ' : suffix === '県' ? 'けん' : 'どう';
	prefectureLookupMap.set(meta.hiragana + hSuffix, prefKanji);
	prefectureLookupMap.set(meta.hiragana, prefKanji);

	// ローマ字
	const rSuffix = suffix === '都' ? 'to' : suffix === '府' ? 'fu' : suffix === '県' ? 'ken' : '';
	prefectureLookupMap.set(meta.romaji + rSuffix, prefKanji);
	prefectureLookupMap.set(`${meta.romaji}-${rSuffix}`, prefKanji);
	prefectureLookupMap.set(meta.romaji, prefKanji);
}

// 特別な別名・表記揺れ
prefectureLookupMap.set('ほっかい', '北海道');
prefectureLookupMap.set('hokkai', '北海道');
prefectureLookupMap.set('tokyoto', '東京都');
prefectureLookupMap.set('kyotofu', '京都府');
prefectureLookupMap.set('osakafu', '大阪府');

/**
 * 入力文字列がいずれかの都道府県にマッチするか判定し、マッチした場合はその漢字名を返す
 */
export const normalizeAndMatchPrefecture = (input: string): PrefectureKanji | null => {
	const normalized = normalizeAnswerString(input);
	return prefectureLookupMap.get(normalized) ?? null;
};

/**
 * 与えられたテキストから、指定された都道府県の名前や関連表記を「〇〇」でマスクする
 */
export const maskPrefecture = (text: string, pref: PrefectureKanji): string => {
	const meta = prefectureMetaList[pref];
	const suffix = pref.slice(-1);
	const stem = pref.slice(0, -1);

	// 長い表記から順にマスクする
	const targets: string[] = [
		pref, // 例: 滋賀県
	];

	if (pref !== '北海道') {
		targets.push(stem); // 例: 滋賀
	}

	const hSuffix = suffix === '都' ? 'と' : suffix === '府' ? 'ふ' : suffix === '県' ? 'けん' : 'どう';
	targets.push(meta.hiragana + hSuffix); // 例: しがけん
	targets.push(meta.hiragana); // 例: しが

	// ソートして長い文字列から置換
	targets.sort((a, b) => b.length - a.length);

	let masked = text;
	for (const target of targets) {
		masked = masked.replaceAll(target, '〇〇');
	}
	return masked;
};

export {prefectures, type PrefectureKanji};
