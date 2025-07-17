export interface TahoiyaTheme {
	word: string;
	ruby: string;
	meaning: string;
	source: string;
	sourceString?: string;
	url?: string;
	id: string | null;
}

export interface TahoiyaMeaning {
	user: string | null;
	dummy: [string, string, string] | null;
	text: string;
}

export interface TahoiyaBetting {
	meaning: number;
	coins: number;
}

export interface TahoiyaComment {
	text: string;
	date: number;
	user: string;
}

export interface TahoiyaRating {
	timestamp: string;
	rating: number;
}

export interface TahoiyaStashedDaily {
	theme: {
		word: string;
		ruby: string;
		meaning: string;
		source: string;
		url: string;
		user: string;
	};
	meanings: [string, string][];
	comments: TahoiyaComment[];
}

export interface TahoiyaGame {
	id: string;
	theme: TahoiyaTheme;
	meanings: Map<string, string>;
	shuffledMeanings: TahoiyaMeaning[];
	bettings: Map<string, TahoiyaBetting>;
	comments: TahoiyaComment[];
	author: string | null;
	phase: 'waiting' | 'collect_meanings' | 'collect_bettings';
	startTime: number;
	endTime: number | null;
}

export interface TahoiyaState {
	phase: 'waiting' | 'collect_meanings' | 'collect_bettings';
	isWaitingDaily: boolean;
	author: string | null;
	authorHistory: string[];
	candidates: unknown[];
	meanings: Map<string, string>;
	shuffledMeanings: TahoiyaMeaning[];
	bettings: Map<string, TahoiyaBetting>;
	theme: TahoiyaTheme | null;
	ratings: Map<string, TahoiyaRating[]>;
	comments: TahoiyaComment[];
	stashedDaily: TahoiyaStashedDaily | null;
	endThisPhase: number | null;
}
