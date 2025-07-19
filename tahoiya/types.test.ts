import type {StateObj, CandidateWord, Theme, ShuffledMeaning, Betting, Rating, Comment} from './types';

describe('Tahoiya Types', () => {
	describe('StateObj', () => {
		it('should have the correct structure', () => {
			const state: StateObj = {
				phase: 'waiting',
				author: null,
				authorHistory: [],
				isWaitingDaily: false,
				candidates: [],
				meanings: new Map(),
				shuffledMeanings: [],
				bettings: new Map(),
				theme: null,
				ratings: new Map(),
				comments: [],
				stashedDaily: null,
				endThisPhase: null,
			};

			expect(state.phase).toBe('waiting');
			expect(state.author).toBeNull();
			expect(Array.isArray(state.authorHistory)).toBe(true);
			expect(state.isWaitingDaily).toBe(false);
			expect(Array.isArray(state.candidates)).toBe(true);
			expect(state.meanings).toBeInstanceOf(Map);
			expect(Array.isArray(state.shuffledMeanings)).toBe(true);
			expect(state.bettings).toBeInstanceOf(Map);
			expect(state.theme).toBeNull();
			expect(state.ratings).toBeInstanceOf(Map);
			expect(Array.isArray(state.comments)).toBe(true);
			expect(state.stashedDaily).toBeNull();
			expect(state.endThisPhase).toBeNull();
		});

		it('should allow valid phase values', () => {
			const phases: StateObj['phase'][] = ['waiting', 'collect_meanings', 'collect_bettings'];
			
			phases.forEach(phase => {
				expect(['waiting', 'collect_meanings', 'collect_bettings']).toContain(phase);
			});
		});
	});

	describe('CandidateWord', () => {
		it('should be a tuple of 5 strings', () => {
			const candidate: CandidateWord = ['word', 'ruby', 'source', 'meaning', 'id'];
			
			expect(Array.isArray(candidate)).toBe(true);
			expect(candidate.length).toBe(5);
			expect(typeof candidate[0]).toBe('string');
			expect(typeof candidate[1]).toBe('string');
			expect(typeof candidate[2]).toBe('string');
			expect(typeof candidate[3]).toBe('string');
			expect(typeof candidate[4]).toBe('string');
		});
	});

	describe('Theme', () => {
		it('should have the correct structure', () => {
			const theme: Theme = {
				word: 'テスト',
				ruby: 'てすと',
				meaning: 'テストの意味',
				source: 'wikipedia',
				sourceString: 'Wikipedia',
				url: 'https://example.com',
				id: 'test-id',
			};

			expect(typeof theme.word).toBe('string');
			expect(typeof theme.ruby).toBe('string');
			expect(typeof theme.meaning).toBe('string');
			expect(theme.source === null || typeof theme.source === 'string').toBe(true);
			expect(theme.id === null || typeof theme.id === 'string').toBe(true);
		});
	});

	describe('ShuffledMeaning', () => {
		it('should have the correct structure', () => {
			const meaning: ShuffledMeaning = {
				user: 'U12345',
				dummy: null,
				text: 'テストの意味',
			};

			expect(meaning.user === null || typeof meaning.user === 'string').toBe(true);
			expect(meaning.dummy === null || Array.isArray(meaning.dummy)).toBe(true);
			expect(typeof meaning.text).toBe('string');
		});
	});

	describe('Betting', () => {
		it('should have the correct structure', () => {
			const betting: Betting = {
				meaning: 1,
				coins: 3,
			};

			expect(typeof betting.meaning).toBe('number');
			expect(typeof betting.coins).toBe('number');
		});
	});

	describe('Rating', () => {
		it('should have the correct structure', () => {
			const rating: Rating = {
				timestamp: '2023-01-01T00:00:00.000Z',
				rating: 5,
			};

			expect(typeof rating.timestamp).toBe('string');
			expect(typeof rating.rating).toBe('number');
		});
	});

	describe('Comment', () => {
		it('should have the correct structure', () => {
			const comment: Comment = {
				user: 'U12345',
				text: 'コメントテキスト',
				date: Date.now(),
			};

			expect(typeof comment.user).toBe('string');
			expect(typeof comment.text).toBe('string');
			expect(typeof comment.date).toBe('number');
		});
	});

	describe('Map compatibility', () => {
		it('should work with Map types in StateObj', () => {
			const state: StateObj = {
				phase: 'waiting',
				author: null,
				authorHistory: [],
				isWaitingDaily: false,
				candidates: [],
				meanings: new Map([['U12345', 'テストの意味']]),
				shuffledMeanings: [],
				bettings: new Map([['U12345', {meaning: 1, coins: 2}]]),
				theme: null,
				ratings: new Map([['U12345', [{timestamp: '2023-01-01T00:00:00.000Z', rating: 5}]]]),
				comments: [],
				stashedDaily: null,
				endThisPhase: null,
			};

			expect(state.meanings.get('U12345')).toBe('テストの意味');
			expect(state.bettings.get('U12345')).toEqual({meaning: 1, coins: 2});
			expect(state.ratings.get('U12345')).toEqual([{timestamp: '2023-01-01T00:00:00.000Z', rating: 5}]);
		});
	});
});