import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

export interface WordSquareClue {
	word: string;
	definition: string;
	definitionCensored: string;
	probabilityOrder: number | null;
	index: number;
}

export interface WordSquare {
	board: string[];
	rows: WordSquareClue[];
	cols: WordSquareClue[];
}

const loadStage = async (symmetric: boolean) => {
	const db = await sqlite.open({
		filename: path.join(__dirname, 'stages.sqlite3'),
		driver: sqlite3.Database,
	});
	const stage = await db.get<{board: string; rows: string; cols: string}>(
		symmetric
			? 'SELECT board, rows, cols FROM stages WHERE is_symmetric = 1 ORDER BY RANDOM() LIMIT 1'
			: 'SELECT board, rows, cols FROM stages WHERE unique_words = 14 ORDER BY RANDOM() LIMIT 1',
	);
	return stage ?? null;
};

interface DefinitionRow {
	word: string;
	definition: string;
	definition_censored: string;
	probability_order: number | null;
}

const loadDefinitions = async (words: string[]) => {
	const db = await sqlite.open({
		filename: path.join(__dirname, 'definitions.sqlite3'),
		driver: sqlite3.Database,
	});
	const uniqueWords = Array.from(new Set(words));
	if (uniqueWords.length === 0) {
		return new Map<string, DefinitionRow>();
	}
	const placeholders = uniqueWords.map(() => '?').join(',');
	const rows = await db.all<DefinitionRow[]>(
		`SELECT word, definition, definition_censored, probability_order FROM definitions WHERE word IN (${placeholders})`,
		uniqueWords,
	);
	const definitions = new Map<string, DefinitionRow>();
	for (const row of rows) {
		definitions.set(row.word, row);
	}
	return definitions;
};

const generateWordSquare = async (symmetric: boolean = false): Promise<WordSquare | null> => {
	const stage = await loadStage(symmetric);
	if (!stage) {
		return null;
	}
	const rows = JSON.parse(stage.rows) as string[];
	const cols = JSON.parse(stage.cols) as string[];
	const board = stage.board.split('');

	if (rows.length !== 7 || cols.length !== 7 || board.length !== 49) {
		return null;
	}

	const definitions = await loadDefinitions([...rows, ...cols]);
	const toClue = (word: string, index: number): WordSquareClue => {
		const def = definitions.get(word);
		return {
			word,
			definition: def?.definition ?? '(no definition)',
			definitionCensored: def?.definition_censored ?? '(no definition)',
			probabilityOrder: def?.probability_order ?? null,
			index,
		};
	};
	return {
		board,
		rows: rows.map((word, index) => toClue(word, index)),
		cols: cols.map((word, index) => toClue(word, index)),
	};
};

export default generateWordSquare;
