import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

export interface WordSquareClue {
	word: string;
	definition: string;
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

const loadDefinitions = async (words: string[]) => {
	const db = await sqlite.open({
		filename: path.join(__dirname, 'definitions.sqlite3'),
		driver: sqlite3.Database,
	});
	const uniqueWords = Array.from(new Set(words));
	if (uniqueWords.length === 0) {
		return new Map<string, string>();
	}
	const placeholders = uniqueWords.map(() => '?').join(',');
	const rows = await db.all<Array<{word: string; definition: string}>>(
		`SELECT word, definition FROM definitions WHERE word IN (${placeholders})`,
		uniqueWords,
	);
	const definitions = new Map<string, string>();
	for (const row of rows) {
		definitions.set(row.word, row.definition);
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
	return {
		board,
		rows: rows.map((word, index) => ({
			word,
			definition: definitions.get(word) ?? '(no definition)',
			index,
		})),
		cols: cols.map((word, index) => ({
			word,
			definition: definitions.get(word) ?? '(no definition)',
			index,
		})),
	};
};

export default generateWordSquare;
