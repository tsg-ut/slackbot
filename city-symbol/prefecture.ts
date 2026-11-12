import 'dotenv/config';

import qs from 'querystring';
import type {ChatPostMessageArguments, GenericMessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {sample, sampleSize, shuffle} from 'lodash';
import {z} from 'zod';
import {increment} from '../achievements';
import {AteQuiz, typicalMessageTextsGenerator} from '../atequiz/index';
import type {AteQuizProblem} from '../atequiz/index';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import logger from '../lib/logger';
import openai from '../lib/openai';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Deferred} from '../lib/utils';
import {
	type PrefectureKanji,
	prefectureMetaList,
	normalizeAndMatchPrefecture,
	maskPrefecture,
	getWikimediaImageUrl,
	WIKIPEDIA_USER_AGENT,
} from './common';

const mutex = new Mutex();
const log = logger.child({bot: 'city-symbol/prefecture'});

export interface TextHint {
	type: 'text';
	text: string;
	explanation?: string;
}

export interface ImageHint {
	type: 'image';
	file: string;
	explanation?: string;
}

export type PrefectureHint = TextHint | ImageHint;

export interface GeneratedPrefectureQuiz {
	prefecture: PrefectureKanji;
	hints: PrefectureHint[];
	sources: string[];
}

export interface PrefectureQuizState {
	stockedQuiz: GeneratedPrefectureQuiz | null;
	pastCategories: Record<string, string[]>;
	pastArticles: Record<string, string[]>;
	pastHints: Record<string, string[]>;
}

let statePromise: Promise<PrefectureQuizState> | null = null;

export const getPrefectureQuizState = async (): Promise<PrefectureQuizState> => {
	if (!statePromise) {
		statePromise = State.init<PrefectureQuizState>('prefecture-quiz', {
			stockedQuiz: null,
			pastCategories: {},
			pastArticles: {},
			pastHints: {},
		});
	}
	const state = await statePromise;
	state.pastCategories ??= {};
	state.pastArticles ??= {};
	state.pastHints ??= {};
	return state;
};

export const resetPrefectureQuizStateForTest = () => {
	statePromise = null;
};

/**
 * 文字列から最初に見つかる JSON オブジェクトまたは配列を安全かつ正確に抽出してパースする
 */
export const extractJson = (text: string): any => {
	// 1. コードブロック ```json ... ``` があればその中身を優先
	const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (codeBlockMatch) {
		try {
			return JSON.parse(codeBlockMatch[1].trim());
		} catch {
			// コードブロック内がパースできなければ後続の走査へ
		}
	}

	// 2. 最初の '{' または '[' を探す
	let firstIdx = -1;
	let startChar = '';
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '{' || text[i] === '[') {
			firstIdx = i;
			startChar = text[i];
			break;
		}
	}

	if (firstIdx === -1) {
		throw new Error('No JSON object or array found in text');
	}

	const endChar = startChar === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	let escaped = false;
	let endIdx = -1;

	for (let i = firstIdx; i < text.length; i++) {
		const char = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === '\\') {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (!inString) {
			if (char === startChar) {
				depth++;
			} else if (char === endChar) {
				depth--;
				if (depth === 0) {
					endIdx = i;
					break;
				}
			}
		}
	}

	if (endIdx !== -1) {
		const jsonStr = text.slice(firstIdx, endIdx + 1);
		return JSON.parse(jsonStr);
	}

	throw new Error(`Unterminated JSON ${startChar === '{' ? 'object' : 'array'} in text`);
};

/**
 * オブジェクトやプリミティブ値から安全に文字列を抽出（再帰対応・[object Object]除外）
 */
export const extractStringValue = (val: any, excludedKeys: Set<string> = new Set()): string | null => {
	if (typeof val === 'string') {
		const trimmed = val.trim();
		if (trimmed && trimmed !== '[object Object]') {
			return trimmed;
		}
		return null;
	}
	if (typeof val === 'number') {
		return String(val);
	}
	if (val && typeof val === 'object' && !Array.isArray(val)) {
		const preferredKeys = [
			'text', 'hint', 'content', 'body', 'description', 'message',
			'sentence', 'statement', 'value', 'ヒント', '本文', 'テキスト', '内容', '説明',
		];
		for (const key of preferredKeys) {
			if (!excludedKeys.has(key) && val[key] !== undefined) {
				const str = extractStringValue(val[key], excludedKeys);
				if (str) {
					return str;
				}
			}
		}
		for (const [key, v] of Object.entries(val)) {
			if (!excludedKeys.has(key)) {
				const str = extractStringValue(v, excludedKeys);
				if (str) {
					return str;
				}
			}
		}
	}
	return null;
};

/**
 * AIが出力した単一のヒントアイテム（オブジェクトまたは文字列）を正規化
 */
export const resolveHintItem = (item: any, pref: PrefectureKanji): PrefectureHint | null => {
	if (typeof item === 'string') {
		const text = item.trim();
		if (text && text !== '[object Object]') {
			let maskedText = maskPrefecture(text, pref);
			maskedText = maskedText
				.replace(/(?:当|同)(?:都道府県|都|道|府|県)|この(?:都(?!道府県)|道|府|県)/g, 'この都道府県')
				.replace(/この都道府県道府県/g, 'この都道府県')
				.replace(/^(?:[*_]*)?ヒント\s*[1-5１-５一二三四五][:：・\s]+(?=\S)/u, '');
			return {
				type: 'text',
				text: maskedText,
			};
		}
		return null;
	}

	if (!item || typeof item !== 'object') {
		return null;
	}

	// 1. 画像ファイル名の判定
	const fileCandidate = item.file || item.image || item.filename || item.imageUrl || item.image_url;
	let imageFile: string | null = null;
	if (typeof fileCandidate === 'string') {
		const clean = fileCandidate.replace(/^(?:ファイル|File):/i, '').trim();
		if (clean && clean !== '[object Object]' && (/\.(jpe?g|png|webp|svg)$/i).test(clean)) {
			imageFile = clean;
		}
	} else if (item.type === 'image') {
		for (const v of Object.values(item)) {
			if (typeof v === 'string') {
				const clean = v.replace(/^(?:ファイル|File):/i, '').trim();
				if (clean !== '[object Object]' && (/\.(jpe?g|png|webp|svg)$/i).test(clean)) {
					imageFile = clean;
					break;
				}
			}
		}
	}

	// 2. 解説 (explanation) の抽出
	const explanationKeyPatterns = [
		'explanation', 'reason', 'detail', 'note', 'source', 'comment',
		'解説', '理由', '補足', '詳細', '出典', '注', 'caption',
	];
	let explanation: string | undefined;
	for (const [key, val] of Object.entries(item)) {
		const lowerKey = key.toLowerCase();
		if (explanationKeyPatterns.some((p) => lowerKey.includes(p) || key.includes(p))) {
			const expStr = extractStringValue(val);
			if (expStr) {
				explanation = expStr;
				break;
			}
		}
	}

	if (imageFile) {
		return {
			type: 'image',
			file: imageFile,
			explanation,
		};
	}

	// 3. テキストヒントの抽出
	const textExcludedKeys = new Set([
		'type', 'id', 'level', 'difficulty', 'order', 'index',
		'file', 'image', 'filename', 'imageUrl', 'image_url',
	]);
	for (const key of Object.keys(item)) {
		const lowerKey = key.toLowerCase();
		if (explanationKeyPatterns.some((p) => lowerKey.includes(p) || key.includes(p))) {
			textExcludedKeys.add(key);
		}
	}

	let text: string | null = null;
	const textPreferredKeys = [
		'text', 'hint', 'content', 'body', 'description', 'message', 'sentence', 'statement',
		'ヒント', '本文', 'テキスト', '内容', '説明',
	];
	for (const prop of textPreferredKeys) {
		if (item[prop] !== undefined) {
			text = extractStringValue(item[prop], textExcludedKeys);
			if (text) {
				break;
			}
		}
	}

	if (!text) {
		for (const [k, v] of Object.entries(item)) {
			if (!textExcludedKeys.has(k)) {
				text = extractStringValue(v, textExcludedKeys);
				if (text) {
					break;
				}
			}
		}
	}

	if (!text || text === '[object Object]') {
		return null;
	}

	let maskedText = maskPrefecture(text, pref);
	// 「この県」「当県」などの表記があれば「この都道府県」に統一
	maskedText = maskedText
		.replace(/(?:当|同)(?:都道府県|都|道|府|県)|この(?:都(?!道府県)|道|府|県)/g, 'この都道府県')
		.replace(/この都道府県道府県/g, 'この都道府県')
		.replace(/^(?:[*_]*)?ヒント\s*[1-5１-５一二三四五][:：・\s]+(?=\S)/u, '');

	return {
		type: 'text',
		text: maskedText,
		explanation,
	};
};

/**
 * parsed JSON オブジェクトからヒントのリストを抽出
 */
export const parseHintsFromParsed = (obj: any): any[] => {
	if (Array.isArray(obj)) {
		return obj;
	}
	if (obj && typeof obj === 'object') {
		if (Array.isArray(obj.hints)) {
			return obj.hints;
		}
		if (Array.isArray(obj['ヒント'])) {
			return obj['ヒント'];
		}
		if (Array.isArray(obj.quiz)) {
			return obj.quiz;
		}
		if (obj.hints && typeof obj.hints === 'object' && !Array.isArray(obj.hints)) {
			const vals = Object.values(obj.hints);
			if (vals.length >= 3) {
				return vals;
			}
		}
		if (obj['ヒント'] && typeof obj['ヒント'] === 'object' && !Array.isArray(obj['ヒント'])) {
			const vals = Object.values(obj['ヒント']);
			if (vals.length >= 3) {
				return vals;
			}
		}
		const arr = Object.values(obj).find(Array.isArray);
		if (arr) {
			return arr as any[];
		}
		const values = Object.values(obj);
		if (values.length >= 3) {
			return values;
		}
	}
	return [];
};

/**
 * 抽出されたヒントリストを最大1枚の写真制約および最大5問に正規化
 */
export const normalizeRawHints = (rawList: any[], pref: PrefectureKanji): PrefectureHint[] => {
	let imageCount = 0;
	const result: PrefectureHint[] = [];

	for (const raw of rawList) {
		const resolved = resolveHintItem(raw, pref);
		if (!resolved) {
			continue;
		}

		if (resolved.type === 'image') {
			if (imageCount === 0) {
				imageCount++;
				result.push(resolved);
			} else if (resolved.explanation) {
				// 既に画像がある場合は2枚目以降はexplanationをテキストヒントとして活用
				result.push({
					type: 'text',
					text: maskPrefecture(resolved.explanation, pref),
				});
			}
		} else {
			result.push(resolved);
		}
	}

	return result.slice(0, 5);
};

/**
 * 都道府県当てクイズの progressMessage をフォーマット
 */
export const formatPrefectureProgressMessage = (
	hints: PrefectureHint[],
	deliveredHintCount: number,
	gameMessageUrl: string,
): string => {
	const hintLines: string[] = [];
	const count = Math.min(deliveredHintCount, hints.length);
	for (let i = 0; i < count; i++) {
		const hint = hints[i];
		const num = i + 1;
		if (hint.type === 'image') {
			hintLines.push(`* ヒント${num}: [写真]`);
		} else {
			hintLines.push(`* ヒント${num}: ${hint.text}`);
		}
	}

	return [
		'この都道府県は何でしょう？',
		hintLines.join('\n'),
		'',
		`回答は<${gameMessageUrl}|こちら>から！`,
	].join('\n');
};

const IgnoredCategoryKeywords = [
	'画像提供依頼',
	'スタブ',
	'テンプレート',
	'の一覧',
	'の画像',
	'ウィキポータル',
	'サブスタブ',
	'カテゴリ',
];

const fetchWikipediaApi = async (params: Record<string, string | number | boolean>): Promise<any> => {
	const url = `https://ja.wikipedia.org/w/api.php?${qs.encode({
		format: 'json',
		...params,
	})}`;

	const response = await fetch(url, {
		headers: {
			'User-Agent': WIKIPEDIA_USER_AGENT,
		},
	});

	if (!response.ok) {
		throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
	}

	return response.json();
};

export const getCategoryMembers = async (category: string): Promise<{articles: string[], subcategories: string[]}> => {
	const json = await fetchWikipediaApi({
		action: 'query',
		list: 'categorymembers',
		cmtitle: `Category:${category.replace(/^Category:/, '')}`,
		cmlimit: 50,
	});

	const members = json?.query?.categorymembers || [];
	const articles = members
		.filter((m: any) => m.ns === 0)
		.map((m: any) => m.title as string);
	const subcategories = members
		.filter((m: any) => m.ns === 14)
		.map((m: any) => (m.title as string).replace('Category:', ''))
		.filter((title: string) => !IgnoredCategoryKeywords.some((kw) => title.includes(kw)));

	return {articles, subcategories};
};

export const getArticleContent = async (title: string): Promise<string> => {
	const json = await fetchWikipediaApi({
		action: 'query',
		prop: 'extracts',
		explaintext: true,
		titles: title,
	});

	const pages = json?.query?.pages || {};
	const page = Object.values(pages)[0] as any;
	return page?.extract?.slice(0, 1500) || '';
};

export const getArticleImages = async (title: string): Promise<string[]> => {
	const json = await fetchWikipediaApi({
		action: 'query',
		prop: 'images',
		titles: title,
		imlimit: 25,
	});

	const pages = json?.query?.pages || {};
	const page = Object.values(pages)[0] as any;
	const images = (page?.images || [])
		.map((img: any) => (img.title as string).replace(/^ファイル:/, ''))
		.filter((name: string) => (/\.(jpe?g|png)$/i).test(name) && !(/(icon|logo|stub|map|flag|symbol|sign|seal|coat)/i).test(name));

	return images;
};

export const searchWikipedia = async (query: string): Promise<Array<{title: string, snippet: string}>> => {
	const json = await fetchWikipediaApi({
		action: 'query',
		list: 'search',
		srsearch: query,
		srlimit: 6,
	});

	const searchResults = json?.query?.search || [];
	return searchResults.map((s: any) => ({
		title: s.title,
		snippet: (s.snippet as string).replace(/<[^>]+>/g, ''),
	}));
};

export const PrefectureThemes = [
	'日本一',
	'伝統工芸',
	'郷土料理',
	'祭り',
	'国宝',
	'名所',
	'名産',
	'産業',
	'地理',
	'歴史',
	'発祥',
	'登録有形文化財',
	'統計',
	'温泉',
	'ジオパーク',
	'文化財',
	'記念物',
];

/**
 * BOT側での乱数制御: 都道府県の総合カテゴリ・ポータルからランダムに起点情報を収集
 */
export const collectRandomSeeds = async (pref: PrefectureKanji, state?: PrefectureQuizState) => {
	const mainArticleExtract = await getArticleContent(pref);
	const topCat = await getCategoryMembers(pref);

	const recentCats = new Set(state?.pastCategories?.[pref] || []);
	const recentArticles = new Set(state?.pastArticles?.[pref] || []);

	// 直近で与えたカテゴリを避け、残りのサブカテゴリを優先
	const freshSubcats = topCat.subcategories.filter((cat) => !recentCats.has(cat));
	const subcatPool = freshSubcats.length >= 3 ? freshSubcats : topCat.subcategories;
	const sampledSubcats = sampleSize(subcatPool, Math.min(4, subcatPool.length));

	const sampledArticleTitles: string[] = [];
	const subcatDetails: Array<{category: string, articles: string[]}> = [];

	for (const subcat of sampledSubcats) {
		const members = await getCategoryMembers(subcat);
		// 直近で与えた記事を避ける
		const freshArticles = members.articles.filter((art) => !recentArticles.has(art));
		const articlePool = freshArticles.length >= 2 ? freshArticles : members.articles;
		const sampledArticles = sampleSize(articlePool, Math.min(3, articlePool.length));

		sampledArticleTitles.push(...sampledArticles);
		subcatDetails.push({
			category: subcat,
			articles: sampledArticles,
		});
	}

	// ランダムテーマ検索でさらなる多様性を確保
	const sampledThemes = sampleSize(PrefectureThemes, 2);
	const themeSeeds: Array<{query: string, results: Array<{title: string, snippet: string}>}> = [];

	for (const theme of sampledThemes) {
		const query = `${pref} ${theme}`;
		try {
			const searchResults = await searchWikipedia(query);
			const filtered = searchResults.filter((sr) => !recentArticles.has(sr.title) && sr.title !== pref);
			const picked = filtered.slice(0, 2);
			if (picked.length > 0) {
				themeSeeds.push({
					query,
					results: picked,
				});
				sampledArticleTitles.push(...picked.map((p) => p.title));
			}
		} catch (e: any) {
			log.warn(`Theme search failed for "${query}": ${e?.message}`);
		}
	}

	// State に過去の探索起点（カテゴリ・記事）を記録（最新を一定数保持）
	if (state) {
		const existingCats = state.pastCategories?.[pref] || [];
		const updatedCats = Array.from(new Set([...existingCats, ...sampledSubcats])).slice(-30);

		const existingArticles = state.pastArticles?.[pref] || [];
		const updatedArticles = Array.from(new Set([...existingArticles, ...sampledArticleTitles])).slice(-50);

		state.pastCategories = {
			...state.pastCategories,
			[pref]: updatedCats,
		};
		state.pastArticles = {
			...state.pastArticles,
			[pref]: updatedArticles,
		};
	}

	return {
		mainArticleExtract,
		subcatDetails,
		themeSeeds,
		availableSubcats: topCat.subcategories,
	};
};

const ToolsDefinition = [
	{
		type: 'function' as const,
		function: {
			name: 'get_category_members',
			description: '指定したWikipediaカテゴリに含まれる記事名一覧およびサブカテゴリ一覧を取得します。',
			parameters: {
				type: 'object',
				properties: {
					category: {
						type: 'string',
						description: 'カテゴリ名（例: 滋賀県の文化、滋賀県の歴史など。「Category:」は不要）',
					},
				},
				required: ['category'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_article_content',
			description: '指定したWikipedia記事の本文抜粋を取得します。',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: '記事名（例: 余呉湖、イナズマロックフェス、信楽焼など）',
					},
				},
				required: ['title'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_article_images',
			description: '指定した記事に含まれる写真・画像ファイル名一覧を取得します。写真ヒントに使用したい場合に呼び出します。',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: '記事名',
					},
				},
				required: ['title'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'search_wikipedia',
			description: 'Wikipedia内をキーワード検索します。',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: '検索クエリ（例: 滋賀県 日本一、滋賀県 観光など）',
					},
				},
				required: ['query'],
			},
		},
	},
];

/**
 * AIエージェントにWikipediaを自律回遊させて5つのヒントを生成
 */
export const generatePrefectureQuiz = async (
	pref: PrefectureKanji,
	state?: PrefectureQuizState,
): Promise<GeneratedPrefectureQuiz> => {
	log.info(`Generating prefecture quiz for ${pref}...`);

	const seeds = await collectRandomSeeds(pref, state);
	const investigatedTitles = new Set<string>([pref]);

	const systemPrompt = [
		'あなたは「都道府県当てクイズ」の出題作成エージェントです。',
		'指定された都道府県についてのクイズで、回答者が段階的に推測できるように、5つのヒントを作成します。',
		'利用可能なツールを使ってWikipedia内を自律的に探索し、多種多様な5つの異なる側面（歴史、文化・芸能、地理・自然、産業・特産品、統計・トリビア・名所など）から面白い情報を集めてください。',
		'',
		'## ヒントのルール',
		'### 1. 難易度のグラデーション（簡単な順に出題）',
		'* 5つのヒントは、徐々に正解が分かりやすくなる「簡単な順（難問から平易なヒントへ）」に出題します。',
		'  * ヒント1（超難問）: 最も難しい／連想しにくい／マイナーな統計や知る人ぞ知るトリビア（例: ゲーム機の世帯保有率が全国1位など）',
		'  * ヒント2（難問）: やや難しい情報、または観光名所などの写真（写真ヒントは1回のクイズにつき最大1つまで含めることができます）',
		'  * ヒント3（中難度）: 中程度の難易度の文化・イベント・名物・人物など',
		'  * ヒント4（やや平易）: やや分かりやすい特徴や名産品・名所など',
		'  * ヒント5（決定的）: 最も平易で直接的・決定的な情報（誰でも知っている象徴や日本一の地形、県庁所在地など）',
		'* 【重要】ヒント1およびヒント2では、簡単に都道府県を特定・推測できてしまうヒントを絶対に出さないでください。非常に難しくして構いません。',
		'  * 出してはいけない例（禁止）: 「面積が全国2位」「人口が全国3位」のようなメジャーな基本統計や順位、誰もが知る代表的特産品（お茶・みかん・リンゴ等）、教科書レベルの基本地理。これらは容易に絞り込めてしまうためヒント1・2では厳禁です。',
		'  * ヒント1・2にふさわしい例: マイナーな統計指標（ゲーム機の世帯保有率、カレールー消費量、特定マイナー工芸品の生産シェア等）、知る人ぞ知る歴史上の出来事や地域の珍しい伝統風習、地名を明かさない風景写真。',
		'',
		'### 2. 文体・表現の統一（敬体と「この都道府県」）',
		'* ヒントの文体は必ず「この都道府県は……」「この都道府県では……」「〇〇はこの都道府県にあり……」のように「この都道府県」という言葉を含む表現で統一してください。',
		'* すべてのヒント文の文末は、必ず敬体（「〜です」「〜ます」）を用いてください。「〜である」「〜だ」「〜がある」などの常体は使用しないでください。',
		'',
		'### 3. 地名の一般的な言い換え（簡単になりすぎるのを防止）',
		'* ヒントの文中にその都道府県の特徴的な地名（山、川、島、岬、古戦場、観光地、市区町村名など）が含まれると想定より簡単になってしまうため、ヒント5で意図的に県庁所在地や有名都市を明かす場合を除き、具体的な地名を含めず一般的な言い換えを行ってください。',
		'  * 言い換えの例: 「箱根山」→「東部との境にそびえる山」、「壇ノ浦」→「南西部の海峡」、「吉野山」→「南部の山林」、「浜松市」→「西部の都市」、「琵琶湖」→「中央部に広がる湖」など。',
		'* ヒント文中には答えとなる都道府県名を直接含めてはいけません（言及する場合は必ず「この都道府県」または「〇〇」としてください）。',
		'',
		'### 4. その他のルール',
		'* 5つのヒントは、それぞれその都道府県の異なる側面にフィーチャーしたものが望ましいです。同じトピック（例: 同じ湖や同じ人物）が重複しないようにしてください。',
		'* 写真ヒントを出す場合は、Wikipediaの画像ファイル名（.jpg/.png）を指定してください。キャプションはヒント本文には含めず、explanationにのみ記載してください。',
		'* 各ヒントの長さは50〜80文字程度の簡潔な文章にしてください。嘘の情報を含めないでください。',
		'',
		'探索が完了したら、ツール呼び出しを終了し、必ず最後のメッセージで以下のJSON形式のみを出力してください。',
		'```json',
		'{',
		'  "hints": [',
		'    {"type": "text", "text": "この都道府県は、令和7年の総務省の調査によるとゲーム機の世帯保有率が全国で最も高いです。", "explanation": "ヒント1の解説（例: 令和7年総務省調査）"},',
		'    {"type": "image", "file": "Lake_Yogo.jpg", "explanation": "賤ヶ岳山頂から望んだ余呉湖の写真"},',
		'    {"type": "text", "text": "西日本最大級の野外音楽フェスは、この都道府県初のふるさと観光大使によって毎年この都道府県で開催されています。", "explanation": "イナズマロックフェス（西川貴教）"},',
		'    {"type": "text", "text": "この都道府県には、競技かるたの日本一を競う大会が開催される聖地が存在します。", "explanation": "近江神宮（名人位・クイーン位決定戦）"},',
		'    {"type": "text", "text": "この都道府県には、総貯水量が日本一多く面積が日本一大きい湖が存在し、地域の文化と古くから密接に関わり合っています。", "explanation": "琵琶湖"}',
		'  ]',
		'}',
		'```',
		'* JSONのキー名は必ず英語の小文字で "hints", "type", "text", "file", "explanation" を使用してください。',
		'* 各ヒントの "text" の値は必ずヒント本文の文字列（string）にしてください。オブジェクトや配列にしないでください。',
		'* "hint" や "ヒント" などの別名キーや日本語キーは使用しないでください。',
	].join('\n');

	const subcatInfo = seeds.subcatDetails
		.map((s) => `* カテゴリ「Category:${s.category}」: 関連記事例 [${s.articles.join(', ')}]`)
		.join('\n');

	const themeInfo = (seeds.themeSeeds || [])
		.map((t) => `* 検索「${t.query}」: 候補記事 [${t.results.map((r) => r.title).join(', ')}]`)
		.join('\n');

	const pastHints = state?.pastHints?.[pref] || [];
	const pastHintsSection = pastHints.length > 0 ? [
		'',
		'## 【過去に出題済みのヒント（重複・類似厳禁）】',
		'以下のヒントおよびトピックは、過去にこの都道府県のお題ですでに出題されたため、**今回重複・類似するヒントを作成することは厳禁**です。',
		'同じ名所・観光地、同じ人物・イベント、同じ統計指標、同じ特産品・伝統工芸などを絶対に取り上げず、全く新しい異なる切り口・側面・情報源からヒントを作成してください。',
		...pastHints.map((h, i) => `* 過去出題${i + 1}: ${h}`),
	].join('\n') : '';

	const initialUserPrompt = [
		`今回のお題となる都道府県は「${pref}」です。`,
		'',
		'## BOT側でランダムサンプリングされた今回の探索起点・注目候補',
		subcatInfo,
		...(themeInfo ? ['', '## BOT側でランダムサンプリングされた今回の検索テーマ・候補', themeInfo] : []),
		pastHintsSection,
		'',
		`メイン記事「${pref}」の概要抜粋:`,
		seeds.mainArticleExtract.slice(0, 800),
		'',
		'提供されたツールを使ってカテゴリや記事をさらに自律的に回遊・調査し、多角的な側面から魅力的な5つのヒントを作成してください。',
		'【重要リマインダー】',
		'・文体はすべて敬体（〜です/〜ます）で統一し、「この都道府県」を含む文にしてください。',
		'・ヒント1とヒント2は超難問にしてください（面積・人口の上位や有名な特産品など、簡単に特定できる情報は厳禁です）。',
		'・具体的な地名（山・川・市町村名など）は一般的な言い換え（「南部の山林」「西部の都市」など）を行ってください。',
		'・写真ヒントを含めたい場合は get_article_images を呼んで画像ファイル名を取得してください。',
		...(pastHints.length > 0 ? ['・過去に出題されたヒント・トピックとは重複・類似しない新しい内容にしてください。'] : []),
	].join('\n');

	const messages: any[] = [
		{role: 'system', content: systemPrompt},
		{role: 'user', content: initialUserPrompt},
	];

	// 最大4ターンの自律探索ループ
	for (let step = 0; step < 4; step++) {
		const response = await openai.chat.completions.create({
			model: 'gpt-6-luna',
			messages,
			tools: ToolsDefinition,
			tool_choice: 'auto',
			max_completion_tokens: 2048,
			reasoning_effort: 'none',
		});

		const {message} = response.choices[0];
		messages.push(message);

		if (!message.tool_calls || message.tool_calls.length === 0) {
			break;
		}

		for (const toolCall of message.tool_calls) {
			if (toolCall.type !== 'function') {
				continue;
			}
			const fnName = toolCall.function.name;
			let args: any = {};
			try {
				args = JSON.parse(toolCall.function.arguments);
			} catch (e) {
				args = {};
			}

			let toolResult = '';
			try {
				if (fnName === 'get_category_members') {
					const members = await getCategoryMembers(args.category || '');
					toolResult = JSON.stringify(members);
				} else if (fnName === 'get_article_content') {
					investigatedTitles.add(args.title);
					const content = await getArticleContent(args.title || '');
					toolResult = content;
				} else if (fnName === 'get_article_images') {
					investigatedTitles.add(args.title);
					const images = await getArticleImages(args.title || '');
					toolResult = JSON.stringify(images);
				} else if (fnName === 'search_wikipedia') {
					const searchResults = await searchWikipedia(args.query || '');
					for (const sr of searchResults) {
						investigatedTitles.add(sr.title);
					}
					toolResult = JSON.stringify(searchResults);
				}
			} catch (err: any) {
				log.warn(`Tool call error for ${fnName}: ${err?.message}`);
				toolResult = `Error: ${err?.message}`;
			}

			messages.push({
				role: 'tool',
				tool_call_id: toolCall.id,
				content: toolResult.slice(0, 2000),
			});
		}
	}

	// 最後のメッセージからJSONを抽出
	const lastMessage = messages[messages.length - 1];
	let content = lastMessage?.content || '';

	// もし最後のメッセージがツール呼び出しで終わっていた場合は、追加でJSON出力を促す
	if (!content || (!content.includes('{') && !content.includes('['))) {
		const followUp = await openai.chat.completions.create({
			model: 'gpt-6-luna',
			messages: [
				...messages,
				{
					role: 'user',
					content: 'これまでの調査結果をもとに、必ず指定のルール（敬体「〜です/〜ます」で「この都道府県」を含む、地名を伏せた言い換え、ヒント1・2は超難問）を守って {"hints": [{"type": "text", "text": "ヒント1...", "explanation": "..."}, ...]} の形式のJSONを出力してください。5つのヒントを含めてください。キー名は必ず "text", "type", "explanation" (または "file") とし、"text" は必ず文字列にしてください。',
				},
			],
			max_completion_tokens: 2048,
			reasoning_effort: 'none',
		});
		content = followUp.choices[0].message.content || '';
	}

	let rawHints: any[] = [];
	try {
		const parsed = extractJson(content);
		rawHints = parseHintsFromParsed(parsed);
	} catch (err: any) {
		log.warn(`Failed to extract JSON from initial response, asking for pure JSON... (${err?.message})`);
	}

	let normalizedHints = normalizeRawHints(rawHints, pref);

	if (normalizedHints.length < 5) {
		log.warn(`Fewer than 5 valid hints extracted (${normalizedHints.length}), requesting pure 5-hint JSON...`);
		const retryResponse = await openai.chat.completions.create({
			model: 'gpt-6-luna',
			messages: [
				...messages,
				...(content ? [{role: 'assistant' as const, content}] : []),
				{
					role: 'user',
					content: '5つのヒントが正しく取得できませんでした。前後の解説やマークダウン記法を含めず、必ず5つの要素を持つ {"hints": [{"type": "text", "text": "ヒント1...", "explanation": "..."}, ...]} というJSONオブジェクトのみを出力してください。文体は必ず敬体（〜です/〜ます）で「この都道府県」を含め、ヒント1・2は超難問にし、地名は一般的な表現に言い換えてください。キー名は必ず "type", "text" (ヒント本文の文字列), "explanation" (解説の文字列) にしてください。',
				},
			],
			max_completion_tokens: 2048,
			reasoning_effort: 'none',
		});
		const retryContent = retryResponse.choices[0].message.content || '';
		try {
			const parsed = extractJson(retryContent);
			const retryRawHints = parseHintsFromParsed(parsed);
			const retryNormalized = normalizeRawHints(retryRawHints, pref);
			if (retryNormalized.length >= 5) {
				normalizedHints = retryNormalized;
			}
		} catch (err: any) {
			log.error(`Retry parsing also failed: ${err?.message}`);
		}
	}

	if (normalizedHints.length < 5) {
		throw new Error(`AI generated fewer than 5 valid hints for ${pref} (${normalizedHints.length})`);
	}

	const sources = Array.from(investigatedTitles).slice(0, 6).map((title) => (
		`<https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}|${title}>`
	));

	if (state) {
		const existingHints = state.pastHints?.[pref] || [];
		const newHintSummaries = normalizedHints.map((h) => {
			if (h.type === 'image') {
				return `[写真] ${h.explanation || h.file}`;
			}
			return `${h.text}${h.explanation ? ` (${h.explanation})` : ''}`;
		});
		const updatedHints = [...existingHints, ...newHintSummaries].slice(-20);
		state.pastHints = {
			...state.pastHints,
			[pref]: updatedHints,
		};
	}

	return {
		prefecture: pref,
		hints: normalizedHints,
		sources,
	};
};

/**
 * 都道府県当てクイズ用 AteQuiz
 * - 1つの問題につき5つのヒント
 * - クイズ開始と同時に1つ目のヒント、15秒ごとに1個追加、最後のヒントから30秒で時間切れ
 * - 有効な回答は1人1回のみ、新たなヒントごとに回答権リセット
 */
export interface PrefectureAteQuizOptions {
	onHintDelivered?: (hintCount: number) => void | Promise<void>;
}

export class PrefectureAteQuiz extends AteQuiz {
	private answeredUsers = new Set<string>();

	private lastSubmissionValid = false;

	private deliveredHintCount = 1;

	private onHintDeliveredCallback?: (hintCount: number) => void | Promise<void>;

	public get hintCount(): number {
		return this.deliveredHintCount;
	}

	constructor(
		slack: SlackInterface,
		problem: AteQuizProblem,
		postOptions?: Partial<ChatPostMessageArguments>,
		quizOptions?: PrefectureAteQuizOptions,
	) {
		super(slack, problem, postOptions);
		this.onHintDeliveredCallback = quizOptions?.onHintDelivered;

		this.slack = this.slack || slack.webClient;

		const originalPostMessage = this.slack.chat.postMessage.bind(this.slack.chat);
		const originalReactionsAdd = this.slack.reactions.add.bind(this.slack.reactions);

		// Proxy を介してヒント配信時の回答権リセットと、無効回答時のリアクション抑制をフック
		this.slack = new Proxy(this.slack, {
			get: (target, prop) => {
				if (prop === 'chat') {
					return new Proxy(target.chat, {
						get: (chatTarget, chatProp) => {
							if (chatProp === 'postMessage') {
								return async (args: ChatPostMessageArguments) => {
									const res = await originalPostMessage(args);
									// スレッド宛てメッセージ（ヒント等）が投稿されたら回答権を全員リセット
									if (args.thread_ts) {
										this.answeredUsers.clear();

										const isSubsequentHint = this.problem.hintMessages.some(
											(h) => h.text === args.text && !args.reply_broadcast,
										);
										if (isSubsequentHint) {
											this.deliveredHintCount++;
											try {
												await this.onHintDeliveredCallback?.(this.deliveredHintCount);
											} catch (err: any) {
												log.warn(`Error in onHintDeliveredCallback: ${err?.message}`);
											}
										}
									}
									return res;
								};
							}
							return Reflect.get(chatTarget, chatProp);
						},
					});
				}
				if (prop === 'reactions') {
					return new Proxy(target.reactions, {
						get: (reactionsTarget, reactionsProp) => {
							if (reactionsProp === 'add') {
								return async (args: any) => {
									// 有効な回答（未回答だったユーザーが都道府県名を回答）で不正解だった時だけ ngReaction を付ける
									if (this.lastSubmissionValid) {
										return originalReactionsAdd(args);
									}
									// それ以外（雑談や回答権行使済み発言）はリアクションを付けない
								};
							}
							return Reflect.get(reactionsTarget, reactionsProp);
						},
					});
				}
				return Reflect.get(target, prop);
			},
		});
	}

	override judge(answer: string, user: string): boolean {
		this.lastSubmissionValid = false;

		const matchedPrefecture = normalizeAndMatchPrefecture(answer);
		if (!matchedPrefecture) {
			// 47都道府県の呼称にマッチしない発言は有効な回答とはみなさずスルー
			return false;
		}

		if (this.answeredUsers.has(user)) {
			// このヒント期間ですでに回答権を行使済み
			return false;
		}

		// 回答権を行使
		this.answeredUsers.add(user);
		this.lastSubmissionValid = true;

		return this.problem.correctAnswers.includes(matchedPrefecture);
	}

	override waitSecGen(hintIndex: number): number {
		// hintMessages はヒント2〜5の4つ。
		// hintIndex 0, 1, 2, 3 の時は 15秒後に次のヒントを出題。
		// hintIndex 4 (最後のヒント出題後) の時は 30秒後にタイムアウト。
		if (hintIndex < this.problem.hintMessages.length) {
			return 15;
		}
		return 30;
	}
}

/**
 * 都道府県当てクイズ Bot
 */
export class PrefectureQuizBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^(?:都道府県|県)当てクイズ$/u;

	protected override readonly username = '都道府県当てクイズ';

	protected override readonly iconEmoji = ':japan:';

	protected override readonly allowedChannels: string[] = [process.env.CHANNEL_GAMES];

	private readonly activeQuizzes = new Map<string, {hints: PrefectureHint[]}>();

	private replenishPromise: Promise<GeneratedPrefectureQuiz | null> | null = null;

	constructor(slackClients: SlackInterface) {
		super(slackClients);
		this.initStock().catch((err) => {
			log.error(`Failed to initialize stock: ${err?.message}`);
		});
	}

	private async initStock(): Promise<void> {
		if (process.env.NODE_ENV === 'test') {
			return;
		}

		const state = await getPrefectureQuizState();
		if (!state.stockedQuiz) {
			log.info('No stocked quiz found on startup. Replenishing in background...');
			this.replenishStock().catch((err) => {
				log.error(`Initial stock replenishment failed: ${err?.message}`);
			});
		} else {
			log.info(`Found pre-stocked quiz for ${state.stockedQuiz.prefecture}`);
		}
	}

	public replenishStock(): Promise<GeneratedPrefectureQuiz | null> {
		if (this.replenishPromise) {
			return this.replenishPromise;
		}

		this.replenishPromise = (async () => {
			try {
				const state = await getPrefectureQuizState();
				if (state.stockedQuiz) {
					return state.stockedQuiz;
				}

				const prefList = Object.keys(prefectureMetaList) as PrefectureKanji[];
				const chosenPref = sample(prefList)!;
				log.info(`Replenishing prefecture quiz stock with ${chosenPref}...`);

				let quizData: GeneratedPrefectureQuiz | null = null;
				let lastError: any = null;
				for (let attempt = 0; attempt < 2; attempt++) {
					try {
						quizData = await generatePrefectureQuiz(chosenPref, state);
						break;
					} catch (err: any) {
						lastError = err;
						log.warn(`Stock generation attempt ${attempt + 1} failed for ${chosenPref}: ${err?.message}`);
					}
				}

				if (!quizData) {
					throw lastError;
				}

				state.stockedQuiz = quizData;
				log.info(`Successfully stocked prefecture quiz for ${chosenPref}`);
				return quizData;
			} catch (err: any) {
				log.error(`Failed to replenish quiz stock: ${err?.message}`);
				return null;
			} finally {
				this.replenishPromise = null;
			}
		})();

		return this.replenishPromise;
	}

	protected override formatProgressMessage(
		gameMessageChannel: string,
		gameMessageTs: string,
		gameMessageUrl: string,
	): string {
		const active = this.activeQuizzes.get(gameMessageTs);
		if (active) {
			return formatPrefectureProgressMessage(active.hints, 1, gameMessageUrl);
		}
		return super.formatProgressMessage(gameMessageChannel, gameMessageTs, gameMessageUrl) as string;
	}

	protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		const quizMessageDeferred = new Deferred<string | null>();

		mutex.runExclusive(async () => {
			try {
				const state = await getPrefectureQuizState();

				let quizData: GeneratedPrefectureQuiz | null = null;

				if (state.stockedQuiz) {
					log.info(`Using pre-stocked quiz for ${state.stockedQuiz.prefecture} (zero lag)`);
					quizData = state.stockedQuiz;
					state.stockedQuiz = null;

					// バックグラウンドで直ちに次のストックを非同期補充
					this.replenishStock().catch((err) => {
						log.error(`Background replenish failed: ${err?.message}`);
					});
				} else {
					log.info('No stocked quiz available; generating on demand...');
					if (message.user) {
						try {
							await this.slack.chat.postEphemeral({
								channel,
								text: '都道府県当てクイズを生成中です……',
								username: this.username,
								icon_emoji: this.iconEmoji,
								user: message.user,
							});
						} catch (err: any) {
							log.warn(`Failed to post ephemeral message: ${err?.message}`);
						}
					}

					// 走っているストック生成を待つ、なければ生成
					quizData = await this.replenishStock();
					if (quizData) {
						state.stockedQuiz = null;
					} else {
						const prefList = Object.keys(prefectureMetaList) as PrefectureKanji[];
						const chosenPref = sample(prefList)!;
						quizData = await generatePrefectureQuiz(chosenPref, state);
					}

					// 次回のストックを非同期補充
					this.replenishStock().catch((err) => {
						log.error(`Background replenish failed: ${err?.message}`);
					});
				}

				if (!quizData) {
					throw new Error('Failed to obtain quiz data');
				}

				const chosenPref = quizData.prefecture;
				const {hints} = quizData;

				// ヒント1をメッセージブロック化
				const formatHintContent = (hint: PrefectureHint, index: number): {text: string, blocks?: any[]} => {
					const num = index + 1;
					if (hint.type === 'image') {
						const imageUrl = getWikimediaImageUrl(hint.file);
						return {
							text: `ヒント${num}: [写真]`,
							blocks: [
								{
									type: 'section',
									text: {
										type: 'mrkdwn',
										text: `*ヒント${num}*: [写真]`,
									},
								},
								{
									type: 'image',
									image_url: imageUrl,
									alt_text: `ヒント${num}の写真`,
								},
							],
						};
					}

					return {
						text: `ヒント${num}: ${hint.text}`,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `*ヒント${num}*: ${hint.text}`,
								},
							},
						],
					};
				};

				const hint1 = formatHintContent(hints[0], 0);

				const problemText = '*都道府県当てクイズ！この都道府県はどこでしょう？*\n15秒ごとにヒントが追加されます（全5問）。最後のヒントから30秒で終了です。\n回答権はヒントごとに1人1回！回答はスレッドへ！';

				const problemMessage: ChatPostMessageArguments = {
					channel,
					text: `都道府県当てクイズ！この都道府県はどこでしょう？\n${hint1.text}`,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `${problemText}\n\n${hint1.blocks?.[0]?.text?.text || hint1.text}`,
							},
						},
						...(hints[0].type === 'image' ? [
							{
								type: 'image' as const,
								image_url: getWikimediaImageUrl(hints[0].file),
								alt_text: 'ヒント1の写真',
							},
						] : []),
					],
				};

				// スレッド開始直後に投稿する immediateMessage (ヒント1)
				const immediateMessage: ChatPostMessageArguments = {
					channel,
					text: hint1.text,
					...(hint1.blocks ? {blocks: hint1.blocks} : {}),
				};

				// 残りのヒント2〜5
				const hintMessages: ChatPostMessageArguments[] = hints.slice(1).map((h, i) => {
					const formatted = formatHintContent(h, i + 1);
					return {
						channel,
						text: formatted.text,
						...(formatted.blocks ? {blocks: formatted.blocks} : {}),
					};
				});

				const meta = prefectureMetaList[chosenPref];
				const correctAnswers = [
					chosenPref,
					chosenPref.slice(0, -1),
					meta.hiragana,
					meta.romaji,
				];

				const answerHeader = `正解は *${chosenPref}* (${meta.hiragana}) でした！`;
				const hintExplanations = hints.map((h, i) => {
					const num = i + 1;
					if (h.type === 'image') {
						return `*ヒント${num}*: [写真] ${h.explanation ? `(${h.explanation})` : ''} - <${getWikimediaImageUrl(h.file)}|画像リンク>`;
					}
					return `*ヒント${num}*: ${h.text} ${h.explanation ? `_(${h.explanation})_` : ''}`;
				}).join('\n');

				const answerMessage: ChatPostMessageArguments = {
					channel,
					text: `${answerHeader}\n\n【出題されたヒント】\n${hintExplanations}\n\nWikipedia参考記事: ${quizData.sources.join(', ')}`,
					unfurl_links: false,
					unfurl_media: false,
					blocks: [
						{
							type: 'header',
							text: {
								type: 'plain_text',
								text: `正解: ${chosenPref}`,
							},
						},
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `【出題されたヒントと解説】\n${hintExplanations}`,
							},
						},
						{
							type: 'context',
							elements: [
								{
									type: 'mrkdwn',
									text: `Wikipedia参考記事: ${quizData.sources.join(', ')}`,
								},
							],
						},
					],
				};

				const problem: AteQuizProblem = {
					problemMessage,
					immediateMessage,
					hintMessages,
					solvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.solved(` *${chosenPref}* `),
					},
					unsolvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.unsolved(` *${chosenPref}* `),
					},
					answerMessage,
					correctAnswers,
				};

				const quiz = new PrefectureAteQuiz(
					this.slackClients,
					problem,
					{
						username: '都道府県当てクイズ',
						icon_emoji: ':japan:',
					},
					{
						onHintDelivered: async (count) => {
							const startTs = await quizMessageDeferred.promise;
							if (startTs) {
								await this.updateProgressMessage(startTs, (url) => (
									formatPrefectureProgressMessage(hints, count, url)
								));
							}
						},
					},
				);

				const result = await quiz.start({
					mode: 'normal',
					onStarted: (startMessage) => {
						this.activeQuizzes.set(startMessage.ts!, {hints});
						quizMessageDeferred.resolve(startMessage.ts!);
					},
				});

				const startTs = await quizMessageDeferred.promise;
				if (startTs) {
					await this.deleteProgressMessage(startTs);
					this.activeQuizzes.delete(startTs);
				}

				if (result.state === 'solved' && result.correctAnswerer) {
					await increment(result.correctAnswerer, 'prefecture-quiz-answer');
					await increment(result.correctAnswerer, `prefecture-quiz-answer-${chosenPref}`);
				}
			} catch (error: any) {
				log.error(error.stack || error.message);
				await this.postMessage({
					channel,
					text: `エラーが発生しました: ${error?.message}`,
				});
				quizMessageDeferred.reject(error);
			}
		});

		return quizMessageDeferred.promise;
	}
}

export default (slackClients: SlackInterface) => new PrefectureQuizBot(slackClients);
