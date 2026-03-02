import type {SlackInterface} from '../lib/slack';
import type {GenericMessageEvent, MessageEvent} from '@slack/bolt';
import cloudinary from 'cloudinary';
import {stripIndent} from 'common-tags';
import Queue from 'p-queue';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {extractMessage, isHumanMessage} from '../lib/slackUtils';
import generateWordSquare from './generateWordSquare';
import {renderWordSquare, type RenderMode} from './render';

export const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭'];

const updatesQueue = new Queue({concurrency: 1});

export const computeLabels = (rows: {word: string; index: number}[], cols: {word: string; index: number}[]) => {
	const rowLabels = new Map<number, string>();
	const colLabels = new Map<number, string>();
	const wordToLabel = new Map<string, string>();
	let nextLabel = 0;

	for (const row of rows) {
		if (wordToLabel.has(row.word)) {
			rowLabels.set(row.index, wordToLabel.get(row.word)!);
		} else {
			const label = CIRCLED_NUMBERS[nextLabel++];
			wordToLabel.set(row.word, label);
			rowLabels.set(row.index, label);
		}
	}

	for (const col of cols) {
		if (wordToLabel.has(col.word)) {
			colLabels.set(col.index, wordToLabel.get(col.word)!);
		} else {
			const label = CIRCLED_NUMBERS[nextLabel++];
			wordToLabel.set(col.word, label);
			colLabels.set(col.index, label);
		}
	}

	return {rowLabels, colLabels};
};

const uploadImage = async (board: (string | null)[], rowLabels: Map<number, string>, colLabels: Map<number, string>, mode: RenderMode = 'normal', answered: boolean[] = [], highlighted: Set<number> = new Set(), prerevealed: Set<number> = new Set()) => {
	const imageData = await renderWordSquare(board, rowLabels, colLabels, mode, answered, highlighted, prerevealed);
	const cloudinaryData: any = await new Promise((resolve, reject) => {
		cloudinary.v2.uploader
			.upload_stream({resource_type: 'image'}, (error, response) => {
				if (error) {
					reject(error);
				} else {
					resolve(response);
				}
			})
			.end(imageData);
	});
	return cloudinaryData;
};

interface State {
	thread: string | null;
	channel: string | null;
	isHolding: boolean;
	puzzle: Awaited<ReturnType<typeof generateWordSquare>> | null;
	board: (string | null)[];
	solvedRows: Set<number>;
	solvedCols: Set<number>;
	timeouts: NodeJS.Timeout[];
	endTime: number;
	rowLabels: Map<number, string>;
	colLabels: Map<number, string>;
	prerevealedCells: Set<number>;
}

class WordSquareBot extends ChannelLimitedBot {
	private readonly state: State = {
		thread: null,
		channel: null,
		isHolding: false,
		puzzle: null,
		board: [],
		solvedRows: new Set(),
		solvedCols: new Set(),
		timeouts: [],
		endTime: 0,
		rowLabels: new Map(),
		colLabels: new Map(),
		prerevealedCells: new Set(),
	};

	protected override readonly wakeWordRegex = /^word\s*square(\s+symmetric)?(\s+hard)?$/i;
	protected override readonly username = 'word-square';
	protected override readonly iconEmoji = ':capital_abcd:';

	protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		if (this.state.isHolding) {
			return null;
		}

		const symmetric = /symmetric/i.test(message.text ?? '');
		const hard = /hard/i.test(message.text ?? '');
		const puzzle = await generateWordSquare(symmetric);
		if (!puzzle) {
			await this.postMessage({
				channel,
				text: 'No word square data found. Please build the stages/definitions first.',
			});
			return null;
		}

		this.state.isHolding = true;
		this.state.puzzle = puzzle;
		this.state.board = new Array(49).fill(null);
		this.state.solvedRows = new Set();
		this.state.solvedCols = new Set();
		this.state.timeouts = [];

		this.state.prerevealedCells = new Set();
		if (!hard) {
			const indices = Array.from({length: 49}, (_, i) => i);
			for (let i = indices.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[indices[i], indices[j]] = [indices[j], indices[i]];
			}
			for (const idx of indices.slice(0, 5)) {
				this.state.board[idx] = puzzle.board[idx];
				this.state.prerevealedCells.add(idx);
			}
		}

		const {rowLabels, colLabels} = computeLabels(puzzle.rows, puzzle.cols);
		this.state.rowLabels = rowLabels;
		this.state.colLabels = colLabels;

		const cloudinaryData: any = await uploadImage(this.state.board, this.state.rowLabels, this.state.colLabels, 'normal', [], new Set(), this.state.prerevealedCells);
		const seconds = (puzzle.rows.length + puzzle.cols.length) * 10;

		const difficultyLabel = hard ? ':fire: *Hard Mode*! No letters revealed!' : ':sparkles: *Normal Mode*! 5 letters revealed!';
		const {ts}: any = await this.postMessage({
			channel,
			text: stripIndent`
				Let's play Word Square! ${difficultyLabel}
				Reply *in thread* with any 7-letter word you think fits a row or column.
				You have ${seconds} seconds.
			`,
			attachments: this.buildAttachments(cloudinaryData.secure_url),
		});

		this.state.thread = ts;
		this.state.channel = channel;

		await this.postMessage({
			channel,
			text: 'Reply here with your answers!',
			thread_ts: ts,
		});

		this.state.timeouts.push(setTimeout(() => {
			updatesQueue.add(async () => {
				await this.finish(false);
			});
		}, seconds * 1000));
		this.state.endTime = Date.now() + seconds * 1000;

		return ts ?? null;
	}

	protected override async onMessageEvent(event: MessageEvent) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);
		if (!message || !message.text || !isHumanMessage(message)) {
			return;
		}

		if (!this.state.isHolding || !this.state.puzzle || this.state.thread === null) {
			return;
		}

		if (!('thread_ts' in message) || message.thread_ts !== this.state.thread) {
			return;
		}

		const candidate = message.text.toUpperCase().replace(/[^A-Z]/g, '');
		if (candidate.length !== 7) {
			return;
		}

		const rowMatches = this.state.puzzle.rows
			.filter((row) => row.word === candidate)
			.map((row) => row.index)
			.filter((index) => !this.state.solvedRows.has(index));
		const colMatches = this.state.puzzle.cols
			.filter((col) => col.word === candidate)
			.map((col) => col.index)
			.filter((index) => !this.state.solvedCols.has(index));

		if (rowMatches.length === 0 && colMatches.length === 0) {
			await this.slack.reactions.add({
				name: 'no_good',
				channel: message.channel,
				timestamp: message.ts,
			});
			return;
		}

		await updatesQueue.add(async () => {
			if (!this.state.isHolding || !this.state.puzzle || this.state.thread === null) {
				return;
			}

			const solvedLabels: string[] = [];
			const newIndices = new Set<number>();
			for (const rowIndex of rowMatches) {
				this.state.solvedRows.add(rowIndex);
				for (let x = 0; x < 7; x++) {
					const index = rowIndex * 7 + x;
					if (this.state.board[index] === null) {
						newIndices.add(index);
					}
					this.state.board[index] = this.state.puzzle.board[index];
				}
				solvedLabels.push(this.state.rowLabels.get(rowIndex) ?? '?');
			}

			for (const colIndex of colMatches) {
				this.state.solvedCols.add(colIndex);
				for (let y = 0; y < 7; y++) {
					const index = y * 7 + colIndex;
					if (this.state.board[index] === null) {
						newIndices.add(index);
					}
					this.state.board[index] = this.state.puzzle.board[index];
				}
				solvedLabels.push(this.state.colLabels.get(colIndex) ?? '?');
			}

			// Auto-mark rows/columns as solved when all their cells are filled
			for (let r = 0; r < 7; r++) {
				if (!this.state.solvedRows.has(r) && this.isRowComplete(r)) {
					this.state.solvedRows.add(r);
				}
			}
			for (let c = 0; c < 7; c++) {
				if (!this.state.solvedCols.has(c) && this.isColComplete(c)) {
					this.state.solvedCols.add(c);
				}
			}

			const allSolved = this.state.solvedRows.size === 7 && this.state.solvedCols.size === 7;

			await this.slack.reactions.add({
				name: allSolved ? 'tada' : '+1',
				channel: message.channel,
				timestamp: message.ts,
			});
			if (allSolved) {
				await this.finish(true);
				return;
			}

			const cloudinaryData: any = await uploadImage(this.state.board, this.state.rowLabels, this.state.colLabels, 'normal', [], newIndices, this.state.prerevealedCells);
			await this.slack.chat.update({
				channel: this.state.channel,
				ts: this.state.thread,
				text: stripIndent`
					Keep going! :muscle:
					Reply *in thread* with any 7-letter word you think fits a row or column.
				`,
				attachments: this.buildAttachments(cloudinaryData.secure_url),
			});
		});
	}

	private buildAttachments(imageUrl: string, revealAll: boolean = false) {
		const seenLabels = new Set<string>();
		const clueLines: string[] = [];

		for (const row of this.state.puzzle?.rows ?? []) {
			const label = this.state.rowLabels.get(row.index) ?? '?';
			if (seenLabels.has(label)) {
				continue;
			}
			seenLabels.add(label);
			const word = revealAll ? row.word : this.getRowMask(row.index);
			if (!revealAll && !word.includes('_')) {
				continue;
			}
			const definition = revealAll ? row.definition : row.definitionCensored;
			const prob = row.probabilityOrder !== null ? ` (${row.probabilityOrder})` : '';
			clueLines.push(`${label} \`${word}\`${prob} : ${definition}`);
		}

		for (const col of this.state.puzzle?.cols ?? []) {
			const label = this.state.colLabels.get(col.index) ?? '?';
			if (seenLabels.has(label)) {
				continue;
			}
			seenLabels.add(label);
			const word = revealAll ? col.word : this.getColMask(col.index);
			if (!revealAll && !word.includes('_')) {
				continue;
			}
			const definition = revealAll ? col.definition : col.definitionCensored;
			const prob = col.probabilityOrder !== null ? ` (${col.probabilityOrder})` : '';
			clueLines.push(`${label} \`${word}\`${prob} : ${definition}`);
		}

		return [
			{
				title: 'Word Square',
				image_url: imageUrl,
			},
			{
				title: 'Clues',
				text: clueLines.join('\n'),
			},
		];
	}

	private getRowMask(rowIndex: number) {
		const letters = [];
		for (let x = 0; x < 7; x++) {
			const index = rowIndex * 7 + x;
			letters.push(this.state.board[index] ?? '_');
		}
		return letters.join('');
	}

	private getColMask(colIndex: number) {
		const letters = [];
		for (let y = 0; y < 7; y++) {
			const index = y * 7 + colIndex;
			letters.push(this.state.board[index] ?? '_');
		}
		return letters.join('');
	}

	private isRowComplete(rowIndex: number) {
		for (let x = 0; x < 7; x++) {
			if (this.state.board[rowIndex * 7 + x] === null) {
				return false;
			}
		}
		return true;
	}

	private isColComplete(colIndex: number) {
		for (let y = 0; y < 7; y++) {
			if (this.state.board[y * 7 + colIndex] === null) {
				return false;
			}
		}
		return true;
	}

	private async finish(success: boolean) {
		if (!this.state.isHolding || !this.state.puzzle || this.state.thread === null || this.state.channel === null) {
			return;
		}

		for (const timeout of this.state.timeouts) {
			clearTimeout(timeout);
		}
		this.state.timeouts = [];

		const thread = this.state.thread;
		const channel = this.state.channel;
		const puzzle = this.state.puzzle;

		this.state.isHolding = false;
		this.state.thread = null;
		this.state.channel = null;

		const mode: RenderMode = success ? 'success' : 'gameover';
		const answered = this.state.board.map((cell) => cell !== null);
		const cloudinaryData: any = await uploadImage(puzzle.board, this.state.rowLabels, this.state.colLabels, mode, answered, new Set(), this.state.prerevealedCells);

		await this.postMessage({
			channel,
			thread_ts: thread,
			reply_broadcast: true,
			text: success ? 'Solved! :tada:' : 'Time is up! :sob:',
			attachments: this.buildAttachments(cloudinaryData.secure_url, true),
		});

		await this.deleteProgressMessage(thread);
	}
}

export default async function wordSquare(slackClients: SlackInterface) {
	new WordSquareBot(slackClients);
};
