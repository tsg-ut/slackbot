import type {WordEntry} from '../lib/candidateWords';

export {WordEntry} from '../lib/candidateWords';

export type ThemeType = 'dictionary' | 'arbitrary';

export type DictionarySource = 'wikipedia' | 'wiktionary' | 'ascii' | 'binary' | 'ewords' | 'fideli' | 'nicopedia';

export interface DictionaryTheme {
	type: 'dictionary';
	word: string;
	ruby: string;
	meaning: string;
	source: string;
	sourceString: string;
	sourceUrl: string;
}

export interface ArbitraryTheme {
	type: 'arbitrary';
	question: string;
	answer: string;
	sourceUrl: string;
}

export type Theme = DictionaryTheme | ArbitraryTheme;

export interface StoredTheme {
	id: string;
	submittedBy: string;
	submittedAt: number;
	used: boolean;
	usedAt: number | null;
	theme: Theme;
}

export interface ShuffledMeaning {
	text: string;
	userId: string | null;
	isDummy: boolean;
	isCorrect: boolean;
	dummyWord?: WordEntry;
}

export type NormalGamePhase = 'select_theme' | 'collect_meanings' | 'collect_bettings';
export type DailyGamePhase = 'collect_meanings' | 'collect_bettings';

export interface GameComment {
	user: string;
	text: string;
	timestamp: number;
}

export interface NormalGameState {
	phase: NormalGamePhase;
	startedBy: string;
	candidates: WordEntry[];
	theme: Theme | null;
	meanings: Record<string, string>;
	shuffledMeanings: ShuffledMeaning[];
	votes: Record<string, number>;
	endPhaseAt: number;
	gameMessageTs: string | null;
	bettingMessageTs: string | null;
	startedAt: number;
	comments: GameComment[];
}

export interface DailyGameState {
	phase: DailyGamePhase;
	themeId: string;
	themeAuthor: string;
	theme: Theme;
	meanings: Record<string, string>;
	shuffledMeanings: ShuffledMeaning[];
	votes: Record<string, number>;
	endPhaseAt: number;
	gameMessageTs: string | null;
	bettingMessageTs: string | null;
	startedAt: number;
	comments: GameComment[];
}

export interface TahoiyaState {
	normalGame: NormalGameState | null;
	dailyGame: DailyGameState | null;
	ratings: Record<string, number>;
	gamesPlayed: Record<string, number>;
	lastGameScore: Record<string, number>;
	dailyStatusMessageTs: string | null;
	authorHistory: string[];
}

export interface PlayerResult {
	userId: string;
	score: number;
	isCorrect: boolean;
	deceived: string[];
}

export interface RatingChange {
	userId: string;
	oldRating: number;
	newRating: number;
	delta: number;
}

export interface GameRecord {
	timestamp: number;
	theme: string;
	word: string;
	type: ThemeType;
	sourceString: string;
	url: string;
	meanings: GameRecordMeaning[];
	comments: GameComment[];
	author: string | null;
	participants: string[];
}

export interface GameRecordMeaning {
	text: string;
	type: 'correct' | 'user' | 'dummy';
	user?: string;
	source?: string;
	voters: {user: string}[];
}
