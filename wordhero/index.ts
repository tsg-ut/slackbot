import fs from 'fs';
import {promisify} from 'util';
import path from 'path';
import assert from 'assert';
import {WebClient, RTMClient} from '@slack/client';
import {flatten, sum, sample, random, sortBy, maxBy, sumBy, shuffle} from 'lodash';
// @ts-ignore
import trie from './trie';
// @ts-ignore
import cloudinary from 'cloudinary';
// @ts-ignore
import {stripIndent} from 'common-tags';
// @ts-ignore
import {hiraganize} from 'japanese';
// @ts-ignore
import download from 'download';
import sqlite from 'sqlite';
import render from './render';
import {Deferred} from '../lib/utils';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

const hiraganaLetters = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー'.split('');

const getPrecedings = (index: number) => {
	const ret = [];
	const hasRight = index % 4 !== 3;
	const hasLeft = index % 4 !== 0;
	const hasUp = index >= 4;
	const hasDown = index < 12;
	if (hasRight) {
		ret.push(index + 1);
	}
	if (hasLeft) {
		ret.push(index - 1);
	}
	if (hasUp) {
		ret.push(index - 4);
	}
	if (hasDown) {
		ret.push(index + 4);
	}
	if (hasRight && hasUp) {
		ret.push(index - 3);
	}
	if (hasRight && hasDown) {
		ret.push(index + 5);
	}
	if (hasLeft && hasUp) {
		ret.push(index - 5);
	}
	if (hasLeft && hasDown) {
		ret.push(index + 3);
	}
	return ret;
};

const precedingsList = Array(16).fill(0).map((_, index) => getPrecedings(index));

const getPrefixedWords = (treeNode: any, letters: string[], prefix: string, bitmask: number, index: number, minLength: number) => {
	const ret: string[] = [];
	if (minLength <= prefix.length && treeNode.isTerminal()) {
		ret.push(prefix);
	}
	for (const preceding of precedingsList[index]) {
		if ((bitmask & (1 << preceding)) !== 0) {
			continue;
		}
		const letter = letters[preceding];
		if (letter === null) {
			continue;
		}
		if (!treeNode.step(letter)) {
			continue;
		}
		ret.push(...getPrefixedWords(treeNode, letters, prefix + letter, bitmask | (1 << preceding), preceding, minLength));
		treeNode.back();
	}
	return ret;
}

const getWords = (tree: any, letters: string[], minLength: number) => {
	const set = new Set<string>();
	const treeNode = tree.tree();
	for (const index of letters.keys()) {
		if (letters[index] === null) {
			continue;
		}
		if (!treeNode.step(letters[index])) {
			continue;
		}
		const words = getPrefixedWords(treeNode, letters, letters[index], 1 << index, index, minLength);
		treeNode.back();
		for (const word of words) {
			set.add(word);
		}
	}
	return Array.from(set);
};

const generateBoard = (tree: any, seed: string) => {
	assert(seed.length <= 10);
	let board = null;
	while (board === null) {
		const tempBoard = Array(16).fill(null);
		let pointer = random(0, 15);
		let failed = false;
		for (const index of Array(seed.length).keys()) {
			tempBoard[pointer] = seed[index];
			if (index !== seed.length - 1) {
				const precedings = precedingsList[pointer].filter((cell) => tempBoard[cell] === null);
				if (precedings.length === 0) {
					failed = true;
					break;
				}
				pointer = sample(precedings);
			}
		}
		if (!failed) {
			board = tempBoard;
		}
	}

	while (board.some((letter) => letter === null)) {
		const [targetCellIndex] = sample([...board.entries()].filter(([, letter]) => letter === null));
		const prefixes = [];
		for (const preceding of precedingsList[targetCellIndex]) {
			if (board[preceding] === null) {
				continue;
			}
			prefixes.push(board[preceding]);
			for (const preceding2 of precedingsList[preceding]) {
				if (board[preceding2] === null || preceding === preceding2) {
					continue;
				}
				prefixes.push(board[preceding2] + board[preceding]);
			}
		}
		if (prefixes.length <= 4) {
			continue;
		}
		const counter = new Map(hiraganaLetters.map((letter) => [letter, 0]));
		for (const prefix of prefixes) {
			for (const nextLetter of hiraganaLetters) {
				counter.set(nextLetter, counter.get(nextLetter) + tree.getPrefix(prefix + nextLetter, 0, 5));
			}
		}
		const topLetters = sortBy(Array.from(counter.entries()), ([, count]) => count).reverse().slice(0, 3);
		const [nextLetter] = sample(topLetters);
		board[targetCellIndex] = nextLetter;
	}

	return board;
};

const generateHardBoard = (tree: any, seed: string) => {
	assert(seed.length <= 12);
	let board: string[] = null;
	while (board === null) {
		const tempBoard: string[] = Array(16).fill(null);
		let pointer = random(0, 15);
		let failed = false;
		for (const index of Array(seed.length).keys()) {
			tempBoard[pointer] = seed[index];
			if (index !== seed.length - 1) {
				const precedings = precedingsList[pointer].filter((cell) => tempBoard[cell] === null);
				if (precedings.length === 0) {
					failed = true;
					break;
				}
				pointer = sample(precedings);
			}
		}
		if (!failed) {
			board = tempBoard;
		}
	}

	while (board.some((letter) => letter === null)) {
		const [targetCellIndex] = sample([...board.entries()].filter(([, letter]) => letter === null));
		const counter = new Map(hiraganaLetters.map((letter) => {
			const newBoard = board.slice();
			newBoard[targetCellIndex] = letter;
			return [letter, sumBy(getWords(tree, newBoard, 5), (word) => word.length ** 2)];
		}));
		const [nextLetter] = maxBy(shuffle(Array.from(counter.entries())), ([, count]) => count);
		board[targetCellIndex] = nextLetter;
	}

	return board;
};

const loadDeferred = new Deferred();

const load = async () => {
	if (loadDeferred.isResolved) {
		return loadDeferred.promise;
	}

	for (const file of ['words.txt', 'dictionary.sqlite3', 'LOUDS_LBS.bin', 'LOUDS_label.txt', 'LOUDS_terminal.bin']) {
		const filePath = path.resolve(__dirname, file);

		const exists = await new Promise((resolve) => {
			fs.access(filePath, fs.constants.F_OK, (error) => {
				resolve(!error);
			});
		});

		if (!exists) {
			await download(`https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/${file}`, __dirname, {
				filename: file,
			});
		}
	}

	const data = await promisify(fs.readFile)(path.join(__dirname, 'words.txt'));
	const dictionary = data.toString().split('\n').filter((s) => (
		typeof s === 'string' && 2 <= s.length && s.length <= 16
	));
	const seedWords = dictionary.filter((word) => 7 <= word.length && word.length <= 8);
	const hardSeedWords = dictionary.filter((word) => 9 <= word.length && word.length <= 10);
	const rawTrie = {
		LBS: await promisify(fs.readFile)(path.join(__dirname, 'LOUDS_LBS.bin')),
	    label: await promisify(fs.readFile)(path.join(__dirname, 'LOUDS_label.txt')),
		terminal: await promisify(fs.readFile)(path.join(__dirname, 'LOUDS_terminal.bin'))
	};
	const tree = trie(rawTrie);

	const db = await sqlite.open(path.join(__dirname, 'dictionary.sqlite3'));

	return loadDeferred.resolve({seedWords, hardSeedWords, tree, db});
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const state: {
		thread: string,
		isHolding: boolean,
		words: string[],
		users: {[user: string]: string[]},
	} = {
		thread: null,
		isHolding: false,
		words: [],
		users: {},
	};

	rtm.on('message', async (message) => {
		if (!message.text || message.subtype || message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.thread_ts && message.thread_ts === state.thread) {
			const word = hiraganize(message.text);
			if (!state.words.includes(word)) {
				await slack.reactions.add({
					name: 'no_good',
					channel: message.channel,
					timestamp: message.ts,
				});
				return;
			}
			if (Object.values(state.users).some((words) => words.includes(word))) {
				await slack.reactions.add({
					name: 'innocent',
					channel: message.channel,
					timestamp: message.ts,
				});
				return;
			}
			if (!state.users[message.user]) {
				state.users[message.user] = [];
			}
			state.users[message.user].push(word);
			await slack.reactions.add({
				name: '+1',
				channel: message.channel,
				timestamp: message.ts,
			});
			return;
		}

		if (message.text.match(/^wordhero$/i) || message.text.match(/^hardhero$/i)) {
			if (state.isHolding) {
				return;
			}

			const isHard = Boolean(message.text.match(/^hardhero$/i));
			const {seedWords, hardSeedWords, tree, db} = await load();

			state.isHolding = true;
			const board = isHard ? generateHardBoard(tree, sample(hardSeedWords)) : generateBoard(tree, sample(seedWords));
			state.words = (isHard ? getWords(tree, board, 5) : getWords(tree, board, 1)).filter((word) => word.length >= 3);

			const imageData = await render(board, {color: isHard ? '#D50000' : 'black'});
			const cloudinaryData: any = await new Promise((resolve, reject) => {
				cloudinary.v2.uploader
					.upload_stream({resource_type: 'image'}, (error: any, response: any) => {
						if (error) {
							reject(error);
						} else {
							resolve(response);
						}
					})
					.end(imageData);
			});

			const {ts}: any =  await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: '今から30秒後にWordHeroを始めるよ～ 準備はいいかな～?',
				username: 'wordhero',
				icon_emoji: ':capital_abcd:',
			});

			await new Promise((resolve) => {
				setTimeout(resolve, 30 * 1000);
			});

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					この画像から同じ場所を通らずタテ・ヨコ・ナナメにたどって見つけた3文字以上の単語を
					90秒以内に *スレッドで* 返信してね!
					${isHard ? ':face_with_symbols_on_mouth: *HARD MODE: 5文字以上限定!*' : ''}
				`,
				username: 'wordhero',
				icon_emoji: ':capital_abcd:',
				thread_ts: ts,
				reply_broadcast: true,
				attachments: [{
					title: 'WordHero',
					image_url: cloudinaryData.secure_url,
				}],
			});

			state.thread = ts;

			setTimeout(async () => {
				state.thread = null;
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '～～～～～～～～～～おわり～～～～～～～～～～',
					thread_ts: ts,
					username: 'wordhero',
					icon_emoji: ':capital_abcd:',
				});
				const ranking = Object.entries(state.users).map(([user, words]) => ({
					user,
					words,
					point: sum(words.map((word) => word.length ** 2)),
				})).sort((a, b) => b.point - a.point);
				const appearedWords = new Set(flatten(Object.values(state.users)));
				const wordList = [];
				for (const word of sortBy(state.words.reverse(), (word) => word.length).reverse()) {
					const entry = appearedWords.has(word) ? `*${word}*` : word;
					const data = await db.get('SELECT * FROM words WHERE ruby = ?', word);
					if (word.length >= 5) {
						if (data.description) {
							wordList.push(`${entry} (${data.word}): _${data.description}_`);
						} else {
							wordList.push(`${entry} (${data.word})`);
						}
					} else {
						wordList.push(`${entry} (${data.word})`);
					}
				}
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						結果発表～
					`,
					username: 'wordhero',
					icon_emoji: ':capital_abcd:',
					attachments: [
						...ranking.map(({user, words, point}, index) => ({
							text: `${index + 1}位. <@${user}> ${point}点 (${words.join('、')})`,
							color: index === 0 ? 'danger' : '#EEEEEE',
						})),
						{
							title: `単語一覧 (計${state.words.length}個)`,
							text: wordList.join('\n'),
						},
					],
				});
				state.isHolding = false;
				state.users = {};
			}, 90 * 1000);
			return;
		}
	});
};
