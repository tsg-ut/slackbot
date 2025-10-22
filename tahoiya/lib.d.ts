export type WordEntry = [word: string, ruby: string, source: string, ...rest: any[]];

export interface GetCandidateWordsOptions {
	min?: number;
	max?: number;
}

export function getCandidateWords(options?: GetCandidateWordsOptions): Promise<WordEntry[]>;

export function getMeaning(wordEntry: WordEntry): Promise<string>;

export function normalizeMeaning(input: string): string;

export function getPageTitle(url: string): string;

export function getWordUrl(word: string, source: string, id?: string): string;

export function getIconUrl(source: string): string;

export function getTimeLink(time: number): string;
