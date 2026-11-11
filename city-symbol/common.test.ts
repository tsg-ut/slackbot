import {describe, it, expect} from 'vitest';
import {
	normalizeAndMatchPrefecture,
	maskPrefecture,
	katakanaToHiragana,
	normalizeAnswerString,
} from './common';

describe('city-symbol/common', () => {
	describe('normalizeAndMatchPrefecture', () => {
		it('matches exact kanji names', () => {
			expect(normalizeAndMatchPrefecture('滋賀県')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('東京都')).toBe('東京都');
			expect(normalizeAndMatchPrefecture('北海道')).toBe('北海道');
			expect(normalizeAndMatchPrefecture('大阪府')).toBe('大阪府');
		});

		it('matches stem kanji names', () => {
			expect(normalizeAndMatchPrefecture('滋賀')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('東京')).toBe('東京都');
			expect(normalizeAndMatchPrefecture('大阪')).toBe('大阪府');
		});

		it('matches hiragana and katakana names', () => {
			expect(normalizeAndMatchPrefecture('しが')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('シガ')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('しがけん')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('シガケン')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('ほっかいどう')).toBe('北海道');
			expect(normalizeAndMatchPrefecture('ホッカイドウ')).toBe('北海道');
			expect(normalizeAndMatchPrefecture('とうきょう')).toBe('東京都');
			expect(normalizeAndMatchPrefecture('トウキョウト')).toBe('東京都');
		});

		it('matches romaji names', () => {
			expect(normalizeAndMatchPrefecture('shiga')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('shigaken')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('tokyo')).toBe('東京都');
			expect(normalizeAndMatchPrefecture('hokkaido')).toBe('北海道');
		});

		it('handles whitespace and full-width characters', () => {
			expect(normalizeAndMatchPrefecture('　滋賀　')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('ｓｈｉｇａ')).toBe('滋賀県');
			expect(normalizeAndMatchPrefecture('シガ ケン')).toBe('滋賀県');
		});

		it('returns null for non-prefecture text', () => {
			expect(normalizeAndMatchPrefecture('こんにちは')).toBeNull();
			expect(normalizeAndMatchPrefecture('琵琶湖')).toBeNull();
			expect(normalizeAndMatchPrefecture('わからない')).toBeNull();
			expect(normalizeAndMatchPrefecture('アメリカ')).toBeNull();
		});
	});

	describe('maskPrefecture', () => {
		it('masks prefecture name in text', () => {
			const text = '滋賀県には日本最大の湖である琵琶湖があり、滋賀の豊かな自然に囲まれています。';
			const masked = maskPrefecture(text, '滋賀県');
			expect(masked).toBe('〇〇には日本最大の湖である琵琶湖があり、〇〇の豊かな自然に囲まれています。');
		});

		it('masks hiragana readings', () => {
			const text = 'しがけんの特産品は近江牛です。しがに行こう！';
			const masked = maskPrefecture(text, '滋賀県');
			expect(masked).toBe('〇〇の特産品は近江牛です。〇〇に行こう！');
		});
	});
});
