import fs from 'fs';
import {promisify} from 'util';
import path from 'path';
import {WebClient, RTMClient} from '@slack/client';
import {flatten, maxBy} from 'lodash';
// @ts-ignore
import trie from 'trie-prefix-tree';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

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

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const data = await Promise.all([
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'wikipedia.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'nicopedia.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'ascii.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'binary.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'ewords.txt')),
		promisify(fs.readFile)(path.join(__dirname, '..', 'tahoiya', 'fideli.txt')),
	]);
	const dictionary = new Set(flatten(data.map((datum) => datum.toString().split('\n').map((line) => line.split('\t')[1]))));
	const tree = trie(Array.from(dictionary).filter((s) => typeof s === 'string'));
	const words = getWords(tree, 'んかううういんかいんいうんいかか'.split(''))
	console.log(maxBy(words, (word) => word.length))
};
