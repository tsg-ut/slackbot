import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import {spawn} from 'child_process';
// @ts-ignore
import concat from 'concat-stream';
import {sortBy} from 'lodash';
import boardConfigs from './boards.json';

const stocks: any[] = [];

// 6x6 format to 20x20 format
const convertToNewFormat = (board: string[]) => ( 
	Array(400).fill(null).map((e, i) => {
		const x = i % 20;
		const y = Math.floor(i / 20);
		if (x < 6 && y < 6 && board[y * 6 + x] !== undefined) {
			return board[y * 6 + x];
		}
		return null;
	})
);

const generate = async (usedAt: string) => {
	if (stocks.length === 0) {
		const generator = spawn('../target/release/crossword_generator_main', {cwd: __dirname});
		const output = await new Promise<Buffer>((resolve) => {
			generator.stdout.pipe(concat({encoding: 'buffer'}, (data: Buffer) => {
				resolve(data);
			}));
		});

		const lines = output.toString().split('\n').filter((line) => line);
		for (const line of lines) {
			const [index, board] = line.split(',');
			stocks.push({index: parseInt(index), board: board.split('').map((char) => char === '　' ? null : char)});
		}
	}

	const {index, board} = stocks.shift();
	const constraints = boardConfigs[index];
	const words = sortBy(constraints, ({index}) => index).map(({cells}) => (
		cells.map((cell) => board[cell]).join('')
	));

	const db = await sqlite.open({
		filename: path.join(__dirname, 'crossword.sqlite3'),
		driver: sqlite3.Database,
	});
	const descriptions = await Promise.all(words.map((word) => (
		db.get('SELECT * FROM words WHERE ruby = ? ORDER BY RANDOM() LIMIT 1', word)
	)));

	return {
		words,
		descriptions,
		board: convertToNewFormat(board),
		boardId: `crossword-board-${index + 1}`,
		constraints: constraints.map((constraint) => ({
			cells: constraint.cells.map((cell) => {
				const x = cell % 6;
				const y = Math.floor(cell / 6);
				return y * 20 + x;
			}),
			index: constraint.index,
		})),
	};
};

export default generate;
