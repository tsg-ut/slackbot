// @ts-ignore
import sqlite from 'sqlite';
import path from 'path';
import {spawn} from 'child_process';
// @ts-ignore
import concat from 'concat-stream';
import boardConfigs from './boards.json';

const stocks: any[] = [];

const generate = async () => {
	if (stocks.length === 0) {
		const generator = spawn('../target/release/main', {cwd: __dirname});
		const output = await new Promise<Buffer>((resolve) => {
			generator.stdout.pipe(concat({encoding: 'buffer'}, (data: Buffer) => {
				resolve(data);
			}));
		});

		const lines = output.toString().split('\n').filter((line) => line);
		for (const line of lines) {
			const [index, board] = line.split(',');
			stocks.push({index: parseInt(index), board: board.split('')});
		}
	}

	const {index, board} = stocks.shift();
	const constraints = boardConfigs[index];
	const words = constraints.map(({cells}) => (
		cells.map((cell) => board[cell]).join('')
	));

	const db = await sqlite.open(path.join(__dirname, 'crossword.sqlite3'));
	const descriptions = await Promise.all(words.map((word) => (
		db.get('SELECT * FROM words WHERE ruby = ? ORDER BY RANDOM() LIMIT 1', word)
	)));
	return {words, descriptions, board, index};
};

export default generate;
