import {describe, it, expect, vi} from 'vitest';

vi.mock('../lib/slack');
vi.mock('../lib/openai');

import {
	normalize,
	normalizeAnswer,
	isCorrectAnswer,
	maskHint,
	revealHint,
	validateAndBuildQuiz,
	PockyTheme,
} from './quiz';

describe('pocky/quiz', () => {
	describe('normalize', () => {
		it('normalizes NFKC and lowercases', () => {
			expect(normalize(' ｉＰｈｏｎｅ　')).toBe('iphone');
			expect(normalize('ポッキー')).toBe('ポッキー');
		});
	});

	describe('normalizeAnswer', () => {
		it('hiraganizes and strips symbols and whitespace', () => {
			expect(normalizeAnswer('iPhone')).toBe('iphone');
			expect(normalizeAnswer('アイフォン')).toBe('あいふぉん');
			expect(normalizeAnswer('あいふぉん')).toBe('あいふぉん');
			expect(normalizeAnswer('スマートフォン')).toBe('すまーとふぉん');
			expect(normalizeAnswer('草なぎ 剛')).toBe('草なぎ剛');
		});
	});

	describe('isCorrectAnswer', () => {
		const theme: PockyTheme = {
			word: 'iPhone',
			ruby: 'あいふぉん',
			aliases: ['アイフォン', 'アイホン', 'iphone'],
			source: 'llm',
			sourceDescription: 'AI生成 (gpt-6-luna)',
		};

		it('matches exact word', () => {
			expect(isCorrectAnswer('iPhone', theme)).toBe(true);
		});

		it('matches lowercase word', () => {
			expect(isCorrectAnswer('iphone', theme)).toBe(true);
		});

		it('matches ruby in hiragana', () => {
			expect(isCorrectAnswer('あいふぉん', theme)).toBe(true);
		});

		it('matches alias in katakana', () => {
			expect(isCorrectAnswer('アイフォン', theme)).toBe(true);
			expect(isCorrectAnswer('アイホン', theme)).toBe(true);
		});

		it('rejects incorrect answers', () => {
			expect(isCorrectAnswer('Android', theme)).toBe(false);
			expect(isCorrectAnswer('iPad', theme)).toBe(false);
			expect(isCorrectAnswer('', theme)).toBe(false);
		});

		it('handles compound words with aliases', () => {
			const smartphoneTheme: PockyTheme = {
				word: 'スマートフォン',
				ruby: 'すまーとふぉん',
				aliases: ['スマホ', 'すまほ'],
				source: 'wikipedia',
				sourceDescription: 'Wikipedia PVランキング',
			};

			expect(isCorrectAnswer('スマートフォン', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('すまーとふぉん', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('スマホ', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('すまほ', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('ガラケー', smartphoneTheme)).toBe(false);
		});
	});

	describe('maskHint and revealHint', () => {
		const theme: PockyTheme = {
			word: 'iPhone',
			ruby: 'あいふぉん',
			aliases: ['アイフォン'],
			source: 'llm',
			sourceDescription: 'AI生成 (gpt-6-luna)',
		};

		it('masks hint case-insensitively', () => {
			expect(maskHint('iphone 16', theme)).toBe('〇〇 16');
			expect(maskHint('IPHONE ケース', theme)).toBe('〇〇 ケース');
		});

		it('masks aliases to prevent spoilers', () => {
			expect(maskHint('アイフォン 買取', theme)).toBe('〇〇 買取');
		});

		it('reveals hint preserving word', () => {
			expect(revealHint('iphone 16', theme)).toBe('＊iPhone＊ 16');
			expect(revealHint('IPHONE ケース', theme)).toBe('＊iPhone＊ ケース');
		});
	});

	describe('validateAndBuildQuiz', () => {
		const theme: PockyTheme = {
			word: 'ポッキー',
			ruby: 'ぽっきー',
			aliases: [],
			source: 'dictionary',
			sourceDescription: '辞書 (KanjiBox)',
		};

		it('filters noise and requires at least 5 hints', () => {
			const suggestions = [
				'ポッキー', // 単体除外
				'ポッキーとは', // ノイズ除外
				'ポッキー 意味', // ノイズ除外
				'ポッキーの日',
				'ポッキー 種類',
				'ポッキー 値段',
			];

			// 有効ヒントが3件しかないので null
			expect(validateAndBuildQuiz(theme, suggestions)).toBeNull();
		});

		it('builds quiz when enough valid hints exist', () => {
			const suggestions = [
				'ポッキー',
				'ポッキーの日',
				'ポッキー 種類',
				'ポッキー 値段',
				'ポッキー カロリー',
				'ポッキー 懸賞',
				'ポッキー レシピ',
			];

			const quiz = validateAndBuildQuiz(theme, suggestions);
			expect(quiz).not.toBeNull();
			expect(quiz?.hints.length).toBe(6);
			expect(quiz?.maskedHints[0]).toBe('〇〇の日');
		});
	});
});
