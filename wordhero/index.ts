import fs from 'fs';
import {promisify} from 'util';
import path from 'path';
import assert from 'assert';
import {WebClient, RTMClient} from '@slack/client';
import {flatten, maxBy, sample, random, sortBy} from 'lodash';
// @ts-ignore
import trie from 'trie-prefix-tree';

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

const getPrefixedWords = (tree: any, letters: string[], prefix: string, bitmask: number, index: number) => {
	const ret: string[] = [];
	if (tree.hasWord(prefix)) {
		ret.push(prefix);
	}
	for (const preceding of precedingsList[index]) {
		if ((bitmask & (1 << preceding)) !== 0) {
			continue;
		}
		const letter = letters[preceding];
		if (!tree.isPrefix(prefix + letter)) {
			continue;
		}
		ret.push(...getPrefixedWords(tree, letters, prefix + letter, bitmask | (1 << preceding), preceding));
	}
	return ret;
}

const getWords = (tree: any, letters: string[]) => {
	const set = new Set<string>();
	for (const index of letters.keys()) {
	    const words = getPrefixedWords(tree, letters, '', 0, index);
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
		        counter.set(nextLetter, counter.get(nextLetter) + tree.countPrefix(prefix + nextLetter));
		    }
		}
		const topLetters = sortBy(Array.from(counter.entries()), ([, count]) => count).reverse().slice(0, 3);
		const [nextLetter] = sample(topLetters);
		board[targetCellIndex] = nextLetter;
	}

	return board;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const data = await Promise.all([
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'wikipedia.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'nicopedia.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'ascii.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'binary.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'ewords.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'fideli.txt')),
	]);
	const dictionary = Array.from(new Set(flatten(data.map((datum) => (
		datum.toString().split('\n').map((line) => line.split('\t')[1])
	))))).filter((s) => (
		typeof s === 'string' && 2 <= s.length && s.length <= 16
	));
	const seedWords = dictionary.filter((word) => 8 <= word.length && word.length <= 10);
	const tree = trie(dictionary);
	const lightTree = trie(dictionary.filter((word) => word.length <= 5));
	const board = generateBoard(lightTree, sample(seedWords));
	console.log(board.slice(0, 4))
	console.log(board.slice(4, 8))
	console.log(board.slice(8, 12))
	console.log(board.slice(12, 16))
	const words = getWords(tree, board);
	console.log(words.length)
	console.log(sortBy(words, (word) => word.length).reverse().slice(0, 10))
};
