import type {SlackInterface} from '../lib/slack';
import type {GenericMessageEvent, MessageEvent} from '@slack/bolt';
import cloudinary from 'cloudinary';
import {stripIndent} from 'common-tags';
import Queue from 'p-queue';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {extractMessage, isHumanMessage} from '../lib/slackUtils';
import generateWordSquare from './generateWordSquare';
import {renderWordSquare} from './render';

const updatesQueue = new Queue({concurrency: 1});

const uploadImage = async (board: (string | null)[]) => {
	const imageData = await renderWordSquare(board);
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
	};

	protected override readonly wakeWordRegex = /^word\s*square(\s+symmetric)?$/i;
	protected override readonly username = 'word-square';
	protected override readonly iconEmoji = ':capital_abcd:';

	protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		if (this.state.isHolding) {
			return null;
		}

		const symmetric = /symmetric/i.test(message.text ?? '');
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

		const cloudinaryData: any = await uploadImage(this.state.board);
		const seconds = (puzzle.rows.length + puzzle.cols.length) * 10;

		const {ts}: any = await this.postMessage({
			channel,
			text: stripIndent`
				Let's play Word Square!
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
			for (const rowIndex of rowMatches) {
				this.state.solvedRows.add(rowIndex);
				for (let x = 0; x < 7; x++) {
					const index = rowIndex * 7 + x;
					this.state.board[index] = this.state.puzzle.board[index];
				}
				solvedLabels.push(`R${rowIndex + 1}`);
			}

			for (const colIndex of colMatches) {
				this.state.solvedCols.add(colIndex);
				for (let y = 0; y < 7; y++) {
					const index = y * 7 + colIndex;
					this.state.board[index] = this.state.puzzle.board[index];
				}
				solvedLabels.push(`C${colIndex + 1}`);
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

			const cloudinaryData: any = await uploadImage(this.state.board);
			await this.slack.chat.update({
				channel: this.state.channel,
				ts: this.state.thread,
				text: stripIndent`
					Keep going!
					Reply *in thread* with any 7-letter word you think fits a row or column.
				`,
				attachments: this.buildAttachments(cloudinaryData.secure_url),
			});
		});
	}

	private buildAttachments(imageUrl: string, revealAll: boolean = false) {
		const rowsText = this.state.puzzle?.rows.map((row) => {
			const word = revealAll ? row.word : this.getRowMask(row.index);
			return `R${row.index + 1}. ${word}: ${row.definition}`;
		}).join('\n') ?? '';

		const colsText = this.state.puzzle?.cols.map((col) => {
			const word = revealAll ? col.word : this.getColMask(col.index);
			return `C${col.index + 1}. ${word}: ${col.definition}`;
		}).join('\n') ?? '';

		return [
			{
				title: 'Word Square',
				image_url: imageUrl,
			},
			{
				title: 'Rows',
				text: rowsText,
			},
			{
				title: 'Columns',
				text: colsText,
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

		const cloudinaryData: any = await uploadImage(puzzle.board);

		await this.postMessage({
			channel,
			thread_ts: thread,
			reply_broadcast: true,
			text: success ? 'Solved! Great work.' : 'Time is up!',
			attachments: this.buildAttachments(cloudinaryData.secure_url, true),
		});

		await this.deleteProgressMessage(thread);
	}
}

export default async function wordSquare(slackClients: SlackInterface) {
	new WordSquareBot(slackClients);
};
