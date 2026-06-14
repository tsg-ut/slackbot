import {getCorrectAnswers, isValidPrefectureAnswer, maskAnswers} from './answers';

describe('getCorrectAnswers', () => {
	test('新潟県 returns expected variants', () => {
		const answers = getCorrectAnswers('新潟県');
		expect(answers).toContain('新潟県');
		expect(answers).toContain('新潟');
		expect(answers).toContain('にいがた');
		expect(answers).toContain('にいがたけん');
		expect(answers).toContain('ニイガタ');
	});

	test('東京都 returns expected variants', () => {
		const answers = getCorrectAnswers('東京都');
		expect(answers).toContain('東京都');
		expect(answers).toContain('東京');
		expect(answers).toContain('とうきょう');
		expect(answers).toContain('とうきょうと');
	});

	test('大阪府 returns expected variants', () => {
		const answers = getCorrectAnswers('大阪府');
		expect(answers).toContain('大阪府');
		expect(answers).toContain('大阪');
		expect(answers).toContain('おおさか');
	});

	test('北海道 returns expected variants', () => {
		const answers = getCorrectAnswers('北海道');
		expect(answers).toContain('北海道');
		expect(answers).toContain('ほっかいどう');
	});
});

describe('isValidPrefectureAnswer', () => {
	test('accepts full prefecture names', () => {
		expect(isValidPrefectureAnswer('新潟県')).toBe(true);
		expect(isValidPrefectureAnswer('東京都')).toBe(true);
		expect(isValidPrefectureAnswer('大阪府')).toBe(true);
		expect(isValidPrefectureAnswer('北海道')).toBe(true);
	});

	test('accepts short names without suffix', () => {
		expect(isValidPrefectureAnswer('新潟')).toBe(true);
		expect(isValidPrefectureAnswer('東京')).toBe(true);
		expect(isValidPrefectureAnswer('大阪')).toBe(true);
	});

	test('accepts hiragana readings', () => {
		expect(isValidPrefectureAnswer('にいがた')).toBe(true);
		expect(isValidPrefectureAnswer('にいがたけん')).toBe(true);
		expect(isValidPrefectureAnswer('とうきょう')).toBe(true);
	});

	test('accepts katakana readings', () => {
		expect(isValidPrefectureAnswer('ニイガタ')).toBe(true);
		expect(isValidPrefectureAnswer('トウキョウ')).toBe(true);
	});

	test('rejects non-prefecture strings', () => {
		expect(isValidPrefectureAnswer('こんにちは')).toBe(false);
		expect(isValidPrefectureAnswer('日本')).toBe(false);
		expect(isValidPrefectureAnswer('新潟市')).toBe(false);
		expect(isValidPrefectureAnswer('')).toBe(false);
	});

	test('is case insensitive', () => {
		expect(isValidPrefectureAnswer('ニイガタ')).toBe(true);
		expect(isValidPrefectureAnswer('にいがた')).toBe(true);
	});
});

describe('maskAnswers', () => {
	test('masks prefecture name', () => {
		const result = maskAnswers('新潟県は米どころです', '新潟県');
		expect(result).not.toContain('新潟');
		expect(result).toContain('〇〇');
	});

	test('masks short name', () => {
		const result = maskAnswers('新潟の米はおいしい', '新潟県');
		expect(result).not.toContain('新潟');
		expect(result).toContain('〇〇');
	});

	test('masks old province names', () => {
		const result = maskAnswers('越後平野は広大です', '新潟県');
		expect(result).not.toContain('越後');
		expect(result).toContain('〇〇');
	});

	test('masks佐渡 for 新潟県', () => {
		const result = maskAnswers('佐渡島は美しい', '新潟県');
		expect(result).not.toContain('佐渡');
		expect(result).toContain('〇〇');
	});

	test('does not mask unrelated content', () => {
		const result = maskAnswers('米どころとして有名です', '新潟県');
		expect(result).toBe('米どころとして有名です');
	});
});
