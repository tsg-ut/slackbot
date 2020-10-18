import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import db from '../lib/firestore';
import {sample, negate, isEmpty, maxBy} from 'lodash';
import type {Crossword} from './crossword';

const Boards = db.collection('crossword_boards');

interface Cell {
	x: number,
	y: number,
}

interface Constraint {
	cells: number[],
	descriptionId: string,
}

export const parseBoard = (board: string) => {
	const lines = board.split('\n').filter(negate(isEmpty));

	const cells: Cell[] = [];
	const width = maxBy(lines, (line) => line.length)!.length;
	const height = lines.length;

	for (const [y, line] of lines.entries()) {
		for (const [x, char] of Array.from(line).entries()) {
			if (char !== '　') {
				cells.push({x, y});
			}
		}
	}

	const constraints: Constraint[] = [];

	for (const y of Array(height).keys()) {
		let consecutiveCells: number[] = [];

		for (const x of Array(width).keys()) {
			const char = lines[y][x] || '　';

			if (char !== '　') {
				consecutiveCells.push(y * 20 + x);
			} else {
				if (consecutiveCells.length >= 3) {
					constraints.push({
						cells: consecutiveCells,
						descriptionId: 'ヨコ',
					});
				}
				consecutiveCells = [];
			}
		}

		if (consecutiveCells.length >= 3) {
			constraints.push({
				cells: consecutiveCells,
				descriptionId: 'ヨコ',
			});
		}
	}

	for (const x of Array(width).keys()) {
		let consecutiveCells: number[] = [];

		for (const y of Array(height).keys()) {
			const char = lines[y][x] || '　';

			if (char !== '　') {
				consecutiveCells.push(y * 20 + x);
			} else {
				if (consecutiveCells.length >= 3) {
					constraints.push({
						cells: consecutiveCells,
						descriptionId: 'タテ',
					});
				}
				consecutiveCells = [];
			}
		}

		if (consecutiveCells.length >= 3) {
			constraints.push({
				cells: consecutiveCells,
				descriptionId: 'タテ',
			});
		}
	}

	const normalizedBoard = Array(400).fill(null).map((cell, i) => {
		const x = i % 20;
		const y = Math.floor(i / 20);
		if (y < height) {
			return lines[y][x] || null;
		}
		return null;
	});

	return {
		constraints: constraints,
		board: normalizedBoard,
	};
};


const generate = async (usedAt: string): Promise<Crossword> => {
	const crosswordData = await db.runTransaction(async (transaction) => {
		const query = Boards.where('category', '==', 'grossword').where('used_at', '==', null);
		const results = await transaction.get(query);

		if (results.size === 0) {
			return null;
		}

		const crossword = sample(results.docs);
		transaction.update(crossword.ref, {used_at: usedAt});

		return crossword.data();
	});

	const {board, constraints} = parseBoard(crosswordData.board);
	const words = constraints.map(({cells}) => (
		cells.map((cell) => board[cell]).join('')
	));

	const crosswordDb = await sqlite.open({
		filename: path.join(__dirname, 'crossword.sqlite3'),
		driver: sqlite3.Database,
	});
	const descriptions = await Promise.all(words.map((word) => (
		crosswordDb.get('SELECT * FROM words WHERE ruby = ? ORDER BY RANDOM() LIMIT 1', word)
	)));

	return {
		words,
		descriptions: descriptions.map((description, index) => ({
			...description,
			descriptionId: constraints[index].descriptionId,
		})),
		board,
		boardId: crosswordData.type.replace('-', '-board-'),
		constraints,
	};
};

export default generate;
