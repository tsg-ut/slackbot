/* eslint-env node, jest */
jest.mock('moment');

import moment from 'moment';
import {scoreTimeOfDay, getReactionName} from './time-scoring';

describe('time-scoring', () => {
	describe('scoreTimeOfDay', () => {
		describe('あさ (asa)', () => {
			it('scores "あさ" at 8:59:59 with 100 points', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 8,
						minutes: () => 59,
						seconds: () => 59,
					}),
				}));

				const result = scoreTimeOfDay('あさ');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('asa');
				expect(result?.score).toBeGreaterThan(99);
				expect(result?.score).toBeLessThan(101);
			});

			it('scores "あさ！" at 9:00:01 with high score', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 9,
						minutes: () => 0,
						seconds: () => 1,
					}),
				}));

				const result = scoreTimeOfDay('あさ！');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('asa');
				expect(result?.score).toBeGreaterThan(95);
			});

			it('scores "あさ" at 7:30 with high score', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 7,
						minutes: () => 30,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('あさ');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('asa');
				expect(result?.score).toBeGreaterThan(105);
			});

			it('recognizes "朝" variant', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 8,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('朝');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('asa');
			});

			it('recognizes "asa" in romaji', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 8,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('asa');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('asa');
			});
		});

		describe('よる (yoru)', () => {
			it('scores "よる" at 21:00', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 21,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('よる');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('yoru');
				expect(result?.score).toBeGreaterThan(95);
			});

			it('scores "夜！" at 22:00', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 22,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('夜！');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('yoru');
			});

			it('recognizes "yoru" in romaji', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 21,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('yoru');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('yoru');
			});
		});

		describe('ひる (hiru)', () => {
			it('scores "ひる" at 12:00', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 12,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('ひる');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('hiru');
			});

			it('scores "昼！" at 13:00', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 13,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('昼！');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('hiru');
			});
		});

		describe('みめい (mimei)', () => {
			it('scores "みめい" at 1:30', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 1,
						minutes: () => 30,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('みめい');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('mimei');
			});
		});

		describe('あけがた (akegata)', () => {
			it('scores "あけがた" at 4:30', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 4,
						minutes: () => 30,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('あけがた');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('akegata');
			});

			it('scores "明け方" at 5:00', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 5,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('明け方');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('akegata');
			});
		});

		describe('ゆうがた (yuugata)', () => {
			it('scores "ゆうがた" at 16:30', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 16,
						minutes: () => 30,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('ゆうがた');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('yuugata');
			});

			it('scores "夕方" at 17:00', () => {
				(moment as any).mockImplementation(() => ({
					utcOffset: () => ({
						hour: () => 17,
						minutes: () => 0,
						seconds: () => 0,
					}),
				}));

				const result = scoreTimeOfDay('夕方');
				expect(result).not.toBeNull();
				expect(result?.scoreName).toBe('yuugata');
			});
		});

		it('returns null for non-matching text', () => {
			(moment as any).mockImplementation(() => ({
				utcOffset: () => ({
					hour: () => 12,
					minutes: () => 0,
					seconds: () => 0,
				}),
			}));

			const result = scoreTimeOfDay('こんにちは');
			expect(result).toBeNull();
		});

		it('returns null for partial matches', () => {
			(moment as any).mockImplementation(() => ({
				utcOffset: () => ({
					hour: () => 8,
					minutes: () => 0,
					seconds: () => 0,
				}),
			}));

			const result = scoreTimeOfDay('おあさようございます');
			expect(result).toBeNull();
		});
	});

	describe('getReactionName', () => {
		it('returns "108" for score >= 108', () => {
			expect(getReactionName(108)).toBe('108');
			expect(getReactionName(110)).toBe('108');
		});

		it('returns "100" for score >= 100 and < 108', () => {
			expect(getReactionName(100)).toBe('100');
			expect(getReactionName(105)).toBe('100');
		});

		it('returns "95" for score >= 95 and < 100', () => {
			expect(getReactionName(95)).toBe('95');
			expect(getReactionName(97)).toBe('95');
		});

		it('returns "80" for score >= 80 and < 95', () => {
			expect(getReactionName(80)).toBe('80');
			expect(getReactionName(90)).toBe('80');
		});

		it('returns "50" for score >= 50 and < 80', () => {
			expect(getReactionName(50)).toBe('50');
			expect(getReactionName(60)).toBe('50');
		});

		it('returns "20" for score >= 20 and < 50', () => {
			expect(getReactionName(20)).toBe('20');
			expect(getReactionName(30)).toBe('20');
		});

		it('returns "5ten" for score >= 5 and < 20', () => {
			expect(getReactionName(5)).toBe('5ten');
			expect(getReactionName(10)).toBe('5ten');
		});

		it('returns "0ten" for score < 5', () => {
			expect(getReactionName(0)).toBe('0ten');
			expect(getReactionName(4)).toBe('0ten');
		});
	});

	describe('date-crossing time periods', () => {
		it('scores "やはんごろ" (23:00-01:00) correctly at 23:30', () => {
			(moment as any).mockImplementation(() => ({
				utcOffset: () => ({
					hour: () => 23,
					minutes: () => 30,
					seconds: () => 0,
				}),
			}));

			const result = scoreTimeOfDay('やはんごろ');
			expect(result).not.toBeNull();
			expect(result?.scoreName).toBe('yahangoro');
			expect(result?.score).toBeGreaterThan(95);
		});

		it('scores "やはんごろ" (23:00-01:00) correctly at 0:30', () => {
			(moment as any).mockImplementation(() => ({
				utcOffset: () => ({
					hour: () => 0,
					minutes: () => 30,
					seconds: () => 0,
				}),
			}));

			const result = scoreTimeOfDay('やはんごろ');
			expect(result).not.toBeNull();
			expect(result?.scoreName).toBe('yahangoro');
			expect(result?.score).toBeGreaterThan(95);
		});

		it('scores "やはん" (23:30-00:30) correctly at 0:00', () => {
			(moment as any).mockImplementation(() => ({
				utcOffset: () => ({
					hour: () => 0,
					minutes: () => 0,
					seconds: () => 0,
				}),
			}));

			const result = scoreTimeOfDay('やはん');
			expect(result).not.toBeNull();
			expect(result?.scoreName).toBe('yahan');
			expect(result?.score).toBeGreaterThan(95);
		});

		it('scores "やはんすぎ" (00:00-02:00) correctly at 1:00', () => {
			(moment as any).mockImplementation(() => ({
				utcOffset: () => ({
					hour: () => 1,
					minutes: () => 0,
					seconds: () => 0,
				}),
			}));

			const result = scoreTimeOfDay('やはんすぎ');
			expect(result).not.toBeNull();
			expect(result?.scoreName).toBe('yahansugi');
			expect(result?.score).toBeGreaterThan(95);
		});
	});
});
