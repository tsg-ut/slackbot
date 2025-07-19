export interface StateObj {
	phase: 'waiting' | 'collect_meanings' | 'collect_bettings';
	author: string | null;
	authorHistory: string[];
	isWaitingDaily: boolean;
	candidates: CandidateWord[];
	meanings: Map<string, string>;
	shuffledMeanings: ShuffledMeaning[];
	bettings: Map<string, Betting>;
	theme: Theme | null;
	ratings: Map<string, Rating[]>;
	comments: Comment[];
	stashedDaily: StashedDaily | null;
	endThisPhase: number | null;
}

export type CandidateWord = [string, string, string, string, string];

export interface Theme {
	word: string;
	ruby: string;
	meaning: string;
	source: string | null;
	sourceString?: string;
	url?: string;
	id: string | null;
}

export interface ShuffledMeaning {
	user: string | null;
	dummy: CandidateWord | null;
	text: string;
}

export interface Betting {
	meaning: number;
	coins: number;
}

export interface Rating {
	timestamp: string;
	rating: number;
}

export interface Comment {
	user: string;
	text: string;
	date: number;
}

export interface StashedDaily {
	theme: {
		word: string;
		ruby: string;
		meaning: string;
		source: string;
		url: string;
		user: string;
	};
	meanings: [string, string][];
	comments: Comment[];
}

export interface BotResult {
	result: string;
	modelName: string;
	stdout: string;
	stderr: string;
}

export interface ThemeRow {
	id?: number;
	user: string;
	word: string;
	ruby: string;
	meaning: string;
	source: string;
	url: string;
	ts: number;
	done: number;
}