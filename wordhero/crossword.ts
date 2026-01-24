import type {SlackInterface} from '../lib/slack';
import cloudinary from 'cloudinary';
import {stripIndent} from 'common-tags';
// @ts-expect-error
import {hiraganize} from 'japanese';
import Queue from 'p-queue';
import {renderCrossword} from './render';
import generateCrossword from './generateCrossword';
import generateGrossword from './generateGrossword';
import {unlock, increment} from '../achievements';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {extractMessage} from '../lib/slackUtils';
import type {GenericMessageEvent, MessageEvent} from '@slack/bolt';

interface Description {
	word: string,
	description: string,
	ruby: string,
	descriptionId: string,
}

export interface Crossword {
	words: string[],
	descriptions: Description[],
	board: string[],
	boardId: string,
	constraints: {cells: number[], descriptionId: string}[],
}

interface State {
	thread: string | null,
	channel: string | null,
	isHolding: boolean,
	crossword: Crossword,
	board: string[],
	solvedDescriptions: Set<string>,
	timeouts: NodeJS.Timeout[],
	users: Set<string>,
	contributors: Set<string>,
	endTime: number,
	isGrossword: boolean,
	misses: Map<string, number>,
}

const uploadImage = async (board: {color: string, letter: string}[], boardId: string) => {
	const imageData = await renderCrossword(board, boardId);
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

const updatesQueue = new Queue({concurrency: 1});

const colors = [
	'#FF6F00',
	'#7E57C2',
	'#0288D1',
	'#388E3C',
	'#F44336',
	'#6D4C41',
	'#EC407A',
	'#01579B',
	'#00838F',
	'#558B2F',
	'#8D6E63',
	'#AB47BC',
	'#1E88E5',
	'#009688',
	'#827717',
	'#E65100',
];

const getColor = (isGrossword: boolean, descriptionId: string) => {
	if (isGrossword) {
		return descriptionId.startsWith('タテ') ? colors[2] : colors[4];
	}
	return colors[parseInt(descriptionId) % colors.length];
};

class CrosswordBot extends ChannelLimitedBot {
	private readonly state: State = {
		thread: null,
		channel: null,
		isHolding: false,
		isGrossword: false,
		crossword: null,
		board: [],
		solvedDescriptions: new Set(),
		timeouts: [],
		users: new Set(),
		contributors: new Set(),
		endTime: 0,
		misses: new Map(),
	};

	protected override readonly wakeWordRegex = /^(crossword|grossword)$/i;
	protected override readonly username = 'crossword';
	protected override readonly iconEmoji = ':capital_abcd:';

	protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		if (this.state.isHolding) {
			return null;
		}

		const isGrossword = Boolean(message.text.match(/^grossword$/i));
		const crossword = await (isGrossword ? generateGrossword(message.ts) : generateCrossword(message.ts));
		if (crossword === null) {
			await this.slack.chat.postMessage({
				channel,
				text: stripIndent`
					grosswordのタネがないよ:cry:
				`,
				username: 'crossword',
				icon_emoji: ':capital_abcd:',
			});
			return null;
		}
		this.state.isGrossword = isGrossword;
		this.state.isHolding = true;
		this.state.board = new Array(400).fill(null);
		this.state.solvedDescriptions = new Set();
		this.state.timeouts = [];
		this.state.users = new Set();
		this.state.contributors = new Set();
		this.state.crossword = crossword;
		this.state.misses = new Map();

		const cloudinaryData: any = await uploadImage([], this.state.crossword.boardId);
		const seconds = this.state.crossword.constraints.length * 10;

		const {ts}: any = await this.slack.chat.postMessage({
			channel,
			text: stripIndent`
				楽しいクロスワードパズルを始めるよ～
				マスに入ると思う単語を${seconds}秒以内に *スレッドで* 返信してね!
			`,
			username: 'crossword',
			icon_emoji: ':capital_abcd:',
			attachments: [{
				title: this.state.isGrossword ? 'Grossword' : 'Crossword',
				image_url: cloudinaryData.secure_url,
			}, ...this.state.crossword.descriptions.map(({description, descriptionId}) => {
				const cells = this.state.crossword.constraints.find((constraint) => constraint.descriptionId === descriptionId).cells;
				return {
					text: `${descriptionId}. ${cells.map((cell) => this.state.board[cell] || '◯').join('')}: ${description}`,
					color: getColor(this.state.isGrossword, descriptionId),
				};
			})],
		});

		this.state.thread = ts;
		this.state.channel = channel;

		await this.slack.chat.postMessage({
			channel,
			text: 'ここにお願いします！',
			thread_ts: ts,
			username: 'crossword',
			icon_emoji: ':capital_abcd:',
		});

		this.state.timeouts.push(setTimeout(async () => {
			this.state.thread = null;
			await this.slack.chat.postMessage({
				channel,
				text: '～～～～～～～～～～おわり～～～～～～～～～～',
				thread_ts: ts,
				username: 'crossword',
				icon_emoji: ':capital_abcd:',
			});
			await this.deleteProgressMessage(ts);
			const cloudinaryData: any = await uploadImage(this.state.crossword.board.map((letter, index) => ({
				color: this.state.board[index] === null ? 'gray' : 'black',
				letter,
			})), this.state.crossword.boardId);
			await this.slack.chat.postMessage({
				channel,
				text: stripIndent`
					残念、クリアならず:cry:
				`,
				username: 'crossword',
				icon_emoji: ':capital_abcd:',
				thread_ts: ts,
				reply_broadcast: true,
				attachments: [{
					title: this.state.isGrossword ? 'Grossword' : 'Crossword',
					image_url: cloudinaryData.secure_url,
				}, ...this.state.crossword.descriptions.map(({word, ruby, description, descriptionId}) => ({
					text: `${descriptionId}. ${word} (${ruby}): ${description}`,
					color: this.state.solvedDescriptions.has(descriptionId) ? '#FF6F00' : '',
				}))],
			});
			this.state.isHolding = false;
		}, seconds * 1000));
		this.state.endTime = Date.now() + seconds * 1000;

		return ts ?? null;
	}

	protected override async onMessageEvent(event: MessageEvent) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);

		if (
			message === null ||
			!message.text ||
			message.subtype
		) {
			return;
		}

		const remainingTime = this.state.endTime - Date.now();

		if ('thread_ts' in message && message.thread_ts === this.state.thread) {
			const word = hiraganize(message.text);
			const isFirstAnswer = !this.state.users.has(message.user);
			this.state.users.add(message.user);

			// Check if word is not valid, or if all descriptions with this word are already solved
			const alreadySolved = this.state.crossword.descriptions
				.filter((desc) => desc.ruby === word)
				.every((desc) => this.state.solvedDescriptions.has(desc.descriptionId));
			
			if (!this.state.crossword.words.includes(word) || alreadySolved) {
				if (!this.state.misses.has(message.user)) {
					this.state.misses.set(message.user, 0);
				}
				this.state.misses.set(message.user, this.state.misses.get(message.user) + 1);

				await this.slack.reactions.add({
					name: 'no_good',
					channel: message.channel,
					timestamp: message.ts,
				});
				return;
			}

			const oldOpenCells = this.state.board.filter((cell) => cell !== null).length;

			const newIndices = new Set();

			for (const description of this.state.crossword.descriptions) {
				if (word === description.ruby) {
					for (const letterIndex of this.state.crossword.constraints.find((constraint) => constraint.descriptionId === description.descriptionId).cells) {
						newIndices.add(letterIndex);
						this.state.board[letterIndex] = this.state.crossword.board[letterIndex];
					}
				}
			}

			const newOpenCells = this.state.board.filter((cell) => cell !== null).length;

			// Update which descriptions are fully solved (either directly or through intersections)
			for (const description of this.state.crossword.descriptions) {
				const cells = this.state.crossword.constraints.find((constraint) => constraint.descriptionId === description.descriptionId).cells;
				if (cells.every((cell) => this.state.board[cell] !== null)) {
					this.state.solvedDescriptions.add(description.descriptionId);
				}
			}

			increment(message.user, 'crossword-cells', newOpenCells - oldOpenCells);
			this.state.contributors.add(message.user);

			if (this.state.board.every((cell, index) => this.state.crossword.board[index] === null || cell !== null)) {
				for (const timeout of this.state.timeouts) {
					clearTimeout(timeout);
				}
				const thread = this.state.thread;
				const channel = this.state.channel;
				this.state.thread = null;
				this.state.channel = null;
				this.state.isHolding = false;

				await this.slack.reactions.add({
					name: 'tada',
					channel: message.channel,
					timestamp: message.ts,
				});

				await this.deleteProgressMessage(thread);

				const cloudinaryData: any = await uploadImage(this.state.crossword.board.map((letter) => ({
					color: 'red',
					letter,
				})), this.state.crossword.boardId);

				await this.slack.chat.postMessage({
					channel,
					text: stripIndent`
						クリア！:raised_hands:
					`,
					username: 'crossword',
					icon_emoji: ':capital_abcd:',
					thread_ts: thread,
					reply_broadcast: true,
					attachments: [{
						title: this.state.isGrossword ? 'Grossword' : 'Crossword',
						image_url: cloudinaryData.secure_url,
					}, ...this.state.crossword.descriptions.map(({word, ruby, description, descriptionId}, index) => ({
						text: `${index + 1}. ${word} (${ruby}): ${description}`,
						color: this.state.solvedDescriptions.has(descriptionId) ? '#FF6F00' : '',
					}))],
				});

				await unlock(message.user, 'crossword-clear');
				for (const user of this.state.contributors) {
					await increment(user, 'crossword-wins');
					if (this.state.isGrossword) {
						await increment(user, 'grossword-wins');
					}
					if (this.state.contributors.size >= 11) {
						await unlock(user, 'crossword-contributors-ge-11');
					}
					if (remainingTime >= this.state.crossword.constraints.length * 10000 * 0.75) {
						await unlock(user, 'crossword-game-time-le-quarter');
					}
				}
				for (const [user, misses] of this.state.misses) {
					if (misses >= 20 && !this.state.contributors.has(user)) {
						await unlock(user, 'crossword-misses-ge-20');
					}
				}
				if (this.state.contributors.size === 1) {
					await unlock(message.user, 'crossword-solo');
				}
				if (isFirstAnswer) {
					await unlock(message.user, 'crossword-closer');
				}
				if (remainingTime <= 2000) {
					await unlock(message.user, 'crossword-buzzer-beater');
				}
			} else {
				this.slack.reactions.add({
					name: '+1',
					channel: message.channel,
					timestamp: message.ts,
				});

				const ts = this.state.thread;
				const channel = this.state.channel;
				await updatesQueue.add(async () => {
					const cloudinaryData = await uploadImage(this.state.board.map((letter, index) => (letter === null ? null : {
						color: newIndices.has(index) ? 'red' : 'black',
						letter,
					})), this.state.crossword.boardId);

					const seconds = this.state.crossword.constraints.length * 10;

					await this.slack.chat.update({
						channel,
						text: stripIndent`
							楽しいクロスワードパズルを始めるよ～
							マスに入ると思う単語を${seconds}秒以内に *スレッドで* 返信してね!
						`,
						ts,
						attachments: [{
							title: this.state.isGrossword ? 'Grossword' : 'Crossword',
							image_url: cloudinaryData.secure_url,
						}, ...this.state.crossword.descriptions.map(({description, ruby, descriptionId}, index) => {
							const cells = this.state.crossword.constraints.find((constraint) => constraint.descriptionId === descriptionId).cells;
							return {
								text: `${descriptionId}. ${cells.map((cell) => this.state.board[cell] || '◯').join('')}: ${description}`,
								descriptionId,
								color: getColor(this.state.isGrossword, descriptionId),
							};
						}).filter(({descriptionId}) => (
							!this.state.solvedDescriptions.has(descriptionId)
						))],
					});
				});
			}
		}
	}
}

export default async function crossword(slackClients: SlackInterface) {
	new CrosswordBot(slackClients);
};