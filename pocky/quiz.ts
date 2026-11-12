import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {inspect} from 'node:util';
import axios from 'axios';
import download from 'download';
import {hiraganize} from 'japanese';
import {escapeRegExp, sample} from 'lodash';
import {stripIndents} from 'common-tags';
import type {GenericMessageEvent, MessageEvent} from '@slack/bolt';
import {increment, unlock} from '../achievements/index.js';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import logger from '../lib/logger';
import openai from '../lib/openai';
import type {SlackInterface} from '../lib/slack';
import {extractMessage, isGenericMessage} from '../lib/slackUtils';
import {Deferred} from '../lib/utils';
import {fetchGoogleSuggestions, normalize} from './util';

const log = logger.child({bot: 'pocky/quiz'});

export type ThemeSource = 'dictionary' | 'wikipedia' | 'llm';

export interface PockyTheme {
	word: string;
	ruby: string;
	aliases: string[];
	source: ThemeSource;
	sourceDescription: string;
}

export interface PockyQuiz {
	theme: PockyTheme;
	hints: string[];
	maskedHints: string[];
}

const ignoreRe = /( 英語| 韓国語| 中国語|の?意味|meaning|とは| 読み方)+$/i;

export {normalize};

export function normalizeAnswer(text: string): string {
	return hiraganize(
		text
			.normalize('NFKC')
			.replace(/\ufe0f/g, '')
			.replace(/\u200d/g, ' ')
			.replace(/[\s・･\-_~〜]/g, '')
			.toLowerCase()
	);
}

export function isCorrectAnswer(userAnswer: string, theme: PockyTheme): boolean {
	const normalizedUser = normalizeAnswer(userAnswer);
	if (!normalizedUser) {
		return false;
	}

	const acceptable = [
		theme.word,
		theme.ruby,
		...theme.aliases,
	].map((ans) => normalizeAnswer(ans));

	return acceptable.includes(normalizedUser);
}

export function maskHint(hint: string, theme: PockyTheme): string {
	let masked = hint.replace(new RegExp(escapeRegExp(theme.word), 'gi'), '〇〇');
	for (const alias of theme.aliases) {
		if (alias.length >= 2) {
			masked = masked.replace(new RegExp(escapeRegExp(alias), 'gi'), '〇〇');
		}
	}
	return masked;
}

export function revealHint(hint: string, theme: PockyTheme): string {
	return hint.replace(new RegExp(escapeRegExp(theme.word), 'gi'), `＊${theme.word}＊`);
}

export async function getGoogleSuggestions(text: string): Promise<string[]> {
	try {
		return await fetchGoogleSuggestions(text);
	} catch (error) {
		log.error('Failed to get Google suggestions:', error);
		return [];
	}
}

// 1. 既存辞書 (KanjiBox) ソース
let cachedDictionaryEntries: PockyTheme[] | null = null;

export async function getDictionaryThemes(): Promise<PockyTheme[]> {
	if (cachedDictionaryEntries) {
		return cachedDictionaryEntries;
	}

	const dictionaryPath = path.resolve(__dirname, 'kanjibox.txt');
	const exists = await fs.promises.access(dictionaryPath, fs.constants.R_OK).then(() => true).catch(() => false);
	if (!exists) {
		await download('https://hakata-public.s3-ap-northeast-1.amazonaws.com/slackbot/kanjibox.txt', __dirname, {filename: 'kanjibox.txt'});
	}
	const dictionary = await fs.promises.readFile(dictionaryPath);
	const entries: PockyTheme[] = dictionary.toString().split('\n').filter((line) => (
		!line.startsWith('#') && line.length !== 0
	)).map((line) => {
		const [, word, ruby] = line.split('\t');
		return {
			word,
			ruby,
			aliases: [] as string[],
			source: 'dictionary' as const,
			sourceDescription: '辞書 (KanjiBox)',
		};
	});

	cachedDictionaryEntries = entries;
	return entries;
}

// 2. アプローチA: Wikipedia PV上位記事ソース
let cachedWikipediaThemes: PockyTheme[] | null = null;

export async function getWikipediaThemes(): Promise<PockyTheme[]> {
	if (cachedWikipediaThemes && cachedWikipediaThemes.length > 0) {
		return cachedWikipediaThemes;
	}

	try {
		const now = new Date();
		// 直近過去月の Pageviews を取得（前月をターゲットにする）
		const targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const year = targetDate.getFullYear().toString();
		const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');

		const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ja.wikipedia/all-access/${year}/${month}/all-days`;
		const res = await axios.get(url, {
			headers: {'User-Agent': 'Slackbot-Pocky/1.0 (hakatashi@example.com)'},
			timeout: 10000,
		});

		const rawArticles: {article: string; views: number}[] = res.data?.items?.[0]?.articles ?? [];
		const ignorePattern = /^(メインページ|特別:|Portal:|プロジェクト:|ファイル:|Help:|Wikipedia:|Template:|\d+年|\d+月\d+日)$/;
		const crimeOrDisasterPattern = /(事件|事故|不祥事|問題|疑惑|火災|地震|台風|沈没|虐待|詐欺|死)$/;

		const articles = rawArticles
			.filter((item) => (
				!ignorePattern.test(item.article) &&
				!crimeOrDisasterPattern.test(item.article) &&
				item.article.length >= 2 &&
				item.article.length <= 15
			))
			.map((item) => item.article.replace(/_/g, ' '));

		// tahoiya/wikipedia.txt から読み仮名を照合
		const titleSet = new Set(articles);
		const rubyMap = new Map<string, string>();
		const wikiPath = path.resolve(__dirname, '..', 'tahoiya', 'wikipedia.txt');

		if (fs.existsSync(wikiPath)) {
			const rl = readline.createInterface({
				input: fs.createReadStream(wikiPath),
				crlfDelay: Infinity,
			});

			for await (const line of rl) {
				const [word, ruby] = line.split('\t');
				if (word && ruby && titleSet.has(word)) {
					rubyMap.set(word, ruby);
				}
			}
		}

		const candidates: PockyTheme[] = [];
		for (const title of articles) {
			const cleanTitle = title.replace(/\s*\(.+?\)$/, '');
			let ruby = rubyMap.get(title) || rubyMap.get(cleanTitle);

			if (!ruby && /^[ァ-ヴー\s]+$/.test(cleanTitle)) {
				ruby = hiraganize(cleanTitle);
			}

			if (ruby) {
				candidates.push({
					word: cleanTitle,
					ruby: hiraganize(ruby),
					aliases: [] as string[],
					source: 'wikipedia',
					sourceDescription: 'Wikipedia PVランキング',
				});
			}
		}

		cachedWikipediaThemes = candidates;
		return candidates;
	} catch (error) {
		log.error('Failed to fetch Wikipedia themes:', error);
		return [];
	}
}

// 3. アプローチB: LLM (gpt-6-luna) 生成ソース
const CATEGORIES = [
	'アニメ・漫画・ゲームの有名キャラクター',
	'IT機器・デジタルガジェット・家電製品',
	'現代テクノロジー・AI・Webサービス・アプリ',
	'日常のファッション・髪型・コスメ・美容',
	'日本のタレント・俳優・ミュージシャン・芸人',
	'K-POP・海外セレブ・世界的な有名人・アーティスト',
	'ポピュラーな料理・お菓子・外食チェーン・食品ブランド',
	'日常で広く使われる外来語・カタカナ語',
	'現代の社会用語・複合語・トレンドワード',
	'ゲームタイトル・映画・大ヒット作品名',
];

const INITIAL_CHARS = [
	'あ', 'い', 'う', 'え', 'お',
	'か', 'き', 'く', 'け', 'こ',
	'さ', 'し', 'す', 'せ', 'そ',
	'た', 'ち', 'つ', 'て', 'と',
	'な', 'に', 'ぬ', 'ね', 'の',
	'は', 'ひ', 'ふ', 'へ', 'ほ',
	'ま', 'み', 'む', 'め', 'も',
	'や', 'ゆ', 'よ',
	'ら', 'り', 'る', 'れ', 'ろ',
	'わ',
	'A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'M', 'P', 'S', 'T', 'W',
];

const WORD_TYPES = [
	'カタカナ語（外来語）',
	'アルファベットを含む単語または略称',
	'複合名詞（2つ以上の語が合わさった言葉）',
	'固有名詞（人名・企業名・製品名・キャラクター等）',
];

export async function getLlmThemes(history: string[] = []): Promise<PockyTheme> {
	const category = sample(CATEGORIES)!;
	const initialChar = sample(INITIAL_CHARS)!;
	const wordType = sample(WORD_TYPES)!;

	const historyPrompt = history.length > 0
		? `\n【重要・除外リスト】以下の単語はすでに出題されたため、絶対に出力しないでください:\n${history.slice(-30).map((w) => `• ${w}`).join('\n')}\n`
		: '';

	const prompt = `
あなたはクイズゲームの出題者です。
Googleの検索窓に単語を入力した際、予測候補（サジェスト）が豊富（少なくとも5個以上）に出てくる、世間一般に広く認知された単語を【5つ】リストアップしてください。

【条件】
1. ジャンル: ${category}
2. 頭文字（読みまたは表記）: 「${initialChar}」から始まるもの（カタカナ・アルファベット可）
3. 単語の形態: ${wordType}
4. 知名度: 日本の一般成人の大多数が知っている、日常会話やメディアで頻出するもの。
${historyPrompt}
以下のJSON形式のみを出力してください。Markdownのコードブロックは不要です。
{
  "candidates": [
    {
      "word": "単語（例: スマートフォン、iPhone、ピカチュウ）",
      "ruby": "ひらがな読み（例: すまーとふぉん、あいふぉん、ぴかちゅう）",
      "aliases": ["略称や表記揺れ（例: スマホ、すまほ、アイフォン）"]
    }
  ]
}
`;

	const res = await openai.chat.completions.create({
		model: 'gpt-6-luna',
		messages: [{role: 'user', content: prompt}],
		max_completion_tokens: 1500,
	});

	const content = res.choices[0].message.content?.trim() || '{"candidates": []}';
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	const cleaned = jsonMatch ? jsonMatch[0] : content;
	const parsed = JSON.parse(cleaned);
	const candidates: {word: string; ruby: string; aliases?: string[]}[] = parsed.candidates || [];

	if (candidates.length === 0) {
		throw new Error('LLM did not return any candidates.');
	}

	const selected = sample(candidates)!;
	return {
		word: selected.word,
		ruby: hiraganize(selected.ruby ?? ''),
		aliases: (selected.aliases ?? []).map((a) => a.trim()).filter(Boolean),
		source: 'llm',
		sourceDescription: 'AI生成 (gpt-6-luna)',
	};
}

// サジェスト検証とクイズオブジェクト作成
export function validateAndBuildQuiz(theme: PockyTheme, suggestions: string[]): PockyQuiz | null {
	const normalizedWord = normalize(theme.word);

	const validHints = suggestions.filter((suggestion) => {
		const normalizedSuggestion = normalize(suggestion);
		if (normalizedSuggestion === normalizedWord) {
			return false;
		}
		if (ignoreRe.test(suggestion)) {
			return false;
		}
		return normalizedSuggestion.startsWith(normalizedWord);
	});

	if (validHints.length < 5) {
		return null;
	}

	const maskedHints = validHints.map((hint) => maskHint(hint, theme));

	return {
		theme,
		hints: validHints,
		maskedHints,
	};
}

// 確率 3:2:5 (30% 辞書 / 20% Wikipedia / 50% LLM) に基づく単語選択と問題生成
export async function generateQuiz(history: string[] = []): Promise<PockyQuiz | null> {
	let failures = 0;

	while (failures < 6) {
		failures++;
		const rand = Math.random();
		let targetSource: ThemeSource = 'llm';
		if (rand < 0.3) {
			targetSource = 'dictionary';
		} else if (rand < 0.5) {
			targetSource = 'wikipedia';
		}

		let candidateTheme: PockyTheme | null = null;

		try {
			if (targetSource === 'dictionary') {
				const dict = await getDictionaryThemes();
				if (dict.length > 0) {
					candidateTheme = sample(dict)!;
				}
			} else if (targetSource === 'wikipedia') {
				const wiki = await getWikipediaThemes();
				if (wiki.length > 0) {
					candidateTheme = sample(wiki)!;
				}
			} else {
				candidateTheme = await getLlmThemes(history);
			}

			if (!candidateTheme) {
				continue;
			}

			const suggestions = await getGoogleSuggestions(candidateTheme.word);
			const quiz = validateAndBuildQuiz(candidateTheme, suggestions);

			if (quiz) {
				return quiz;
			}
		} catch (error) {
			log.error(`Error generating quiz from ${targetSource}:`, error);
		}
	}

	return null;
}

interface PockyGame {
	quiz: PockyQuiz;
	channel: string;
	thread: string;
	timer: NodeJS.Timeout;
}

interface PockyGameBotOptions {
	generateQuiz?: (history: string[]) => Promise<PockyQuiz | null>;
}

const isNovember11 = () => (
	new Date().toLocaleString('en-US', {
		timeZone: 'Asia/Tokyo',
		month: 'numeric',
		day: 'numeric',
	}) === '11/11'
);

export class PockyGameBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^ポッキーゲーム$/;

	protected override readonly username = 'pocky';

	protected override readonly iconEmoji = ':google:';

	private game: PockyGame | null = null;

	// 出題の生成中に重複してゲームが開始されるのを防ぐ
	private isGenerating = false;

	private readonly recentThemes: string[] = [];

	private readonly generateQuiz: (history: string[]) => Promise<PockyQuiz | null>;

	constructor(
		protected readonly slackClients: SlackInterface,
		options: PockyGameBotOptions = {},
	) {
		super(slackClients);
		this.generateQuiz = options.generateQuiz ?? generateQuiz;
	}

	protected override onWakeWord(_message: GenericMessageEvent, channel: string): Promise<string | null> {
		const gameMessageDeferred = new Deferred<string | null>();

		(async () => {
			if (this.game !== null) {
				const {permalink} = await this.slack.chat.getPermalink({
					channel: this.game.channel,
					message_ts: this.game.thread,
				});
				await this.postMessage({
					channel,
					text: `<${permalink}|進行中のゲーム>があるよ:thinking_face:`,
					unfurl_links: false,
					unfurl_media: false,
				});
				void gameMessageDeferred.resolve(null);
				return;
			}

			if (this.isGenerating) {
				void gameMessageDeferred.resolve(null);
				return;
			}

			this.isGenerating = true;
			try {
				void gameMessageDeferred.resolve(await this.startGame(channel));
			} finally {
				this.isGenerating = false;
			}
		})().catch((error: unknown) => {
			this.log.error('Failed to start pocky game', error);
			const errorText =
				error instanceof Error && error.stack !== undefined
					? error.stack : inspect(error);
			this.postMessage({
				channel,
				text: `エラー😢\n\`${errorText}\``,
			});
			void gameMessageDeferred.resolve(null);
		});

		return gameMessageDeferred.promise;
	}

	private async startGame(channel: string): Promise<string | null> {
		const quiz = await this.generateQuiz(this.recentThemes);

		if (quiz === null) {
			await this.postMessage({
				channel,
				text: 'エラーΩ＼ζ°)ﾁｰﾝ',
			});
			return null;
		}

		this.recentThemes.push(quiz.theme.word);
		if (this.recentThemes.length > 50) {
			this.recentThemes.shift();
		}

		this.log.info(quiz.theme);

		const {ts: thread} = await this.postMessage({
			channel,
			text: stripIndents`
				ポッキーゲームを始めるよ～
				${quiz.maskedHints.join(' / ')}
			`,
		});

		await this.postMessage({
			channel,
			thread_ts: thread,
			text: stripIndents`
				下の単語の〇〇に共通して入る単語は何かな～？
				スレッドで回答してね!
				3分経過で答えを発表するよ～

				${quiz.maskedHints.map((hint) => `• ${hint}`).join('\n')}
			`,
		});

		const timer = setTimeout(() => {
			this.onTimeUp().catch((error: unknown) => {
				this.log.error('Failed to finish pocky game', error);
			});
		}, 3 * 60 * 1000);

		this.game = {quiz, channel, thread, timer};

		return thread;
	}

	private async onTimeUp() {
		const {game} = this;
		if (game === null) {
			return;
		}
		this.game = null;

		const {quiz: {theme}, channel, thread} = game;

		await this.postMessage({
			channel,
			thread_ts: thread,
			reply_broadcast: true,
			text: stripIndents`
				なんでわからないの？
				答えは＊${theme.word}＊ (${theme.ruby}) だよ:anger:
			`,
		});
		await this.postAnswerDetails(game);
		await this.deleteProgressMessage(thread);
	}

	private async onAnswer(message: GenericMessageEvent, game: PockyGame) {
		const {quiz: {theme}, channel, thread} = game;

		if (!isCorrectAnswer(message.text, theme)) {
			await this.slack.reactions.add({
				name: 'no_good',
				channel: message.channel,
				timestamp: message.ts,
			});
			return;
		}

		clearTimeout(game.timer);
		this.game = null;

		await this.postMessage({
			channel,
			thread_ts: thread,
			reply_broadcast: true,
			text: stripIndents`
				<@${message.user}> 正解:tada:
				答えは＊${theme.word}＊ (${theme.ruby}) だよ:tada:
			`,
		});
		await this.postAnswerDetails(game);
		await this.deleteProgressMessage(thread);

		await increment(message.user, 'pockygame-win');
		if (isNovember11()) {
			await unlock(message.user, 'pockygame-on-nov-11');
		}
	}

	private postAnswerDetails({quiz: {theme, hints}, channel, thread}: PockyGame) {
		const details = [
			`• 出題ソース: ${theme.sourceDescription}`,
			...(theme.aliases.length > 0 ? [`• 別解: ${theme.aliases.join(' / ')}`] : []),
			'',
			...hints.map((hint) => `• ${revealHint(hint, theme)}`),
		].join('\n');

		return this.postMessage({
			channel,
			thread_ts: thread,
			text: details,
		});
	}

	protected override async onMessageEvent(event: MessageEvent) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);

		if (
			message === null ||
			!message.text ||
			!message.user ||
			!isGenericMessage(message)
		) {
			return;
		}

		const {game} = this;
		if (game !== null && message.channel === game.channel && message.thread_ts === game.thread) {
			await this.onAnswer(message, game);
		}
	}
}
