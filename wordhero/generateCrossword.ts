import fs from 'fs';
import {shuffle} from 'lodash';
// @ts-ignore
import trie from 'trie-prefix-tree';
import sqlite from 'sqlite';
import path from 'path';

const words = fs.readFileSync(path.join(__dirname, 'crossword.txt')).toString().split('\n');
const wordTrie = trie(words);
const hiraganaLetters = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー'.split('');

const getBoard = () => {
	for (const letter11 of shuffle(hiraganaLetters)) {
		for (const letter12 of shuffle(hiraganaLetters)) {
			if (letter12 === 'ん') {
				continue;
			}
			if (wordTrie.countPrefix(letter11 + letter12) <= 5) {
				continue;
			}
			for (const letter21 of shuffle(hiraganaLetters)) {
				if (letter21 === 'ん') {
					continue;
				}
				if (wordTrie.countPrefix(letter11 + letter21) <= 5) {
					continue;
				}
				for (const letter22 of shuffle(hiraganaLetters)) {
					if (wordTrie.countPrefix(letter11 + letter22) <= 3) {
						continue;
					}
					if (wordTrie.countPrefix(letter12 + letter22) <= 3) {
						continue;
					}
					if (wordTrie.countPrefix(letter21 + letter22) <= 3) {
						continue;
					}
					for (const word1 of shuffle(wordTrie.getPrefix(letter11 + letter12, false))) {
						const [, , letter13, letter14] = Array.from(word1);
						if (letter13 === 'ん' || letter14 === 'ん') {
							continue;
						}
						for (const word2 of shuffle(wordTrie.getPrefix(letter21 + letter22, false))) {
							const [, , letter23, letter24] = Array.from(word2);
							if (!wordTrie.isPrefix(letter13 + letter23)) {
								continue;
							}
							if (!wordTrie.isPrefix(letter14 + letter24)) {
								continue;
							}
							for (const word6 of shuffle(wordTrie.getPrefix(letter11 + letter21, false))) {
								const [, , letter31, letter41] = Array.from(word6);
								if (letter31 === 'ん' || letter41 === 'ん') {
									continue;
								}
								for (const word7 of shuffle(wordTrie.getPrefix(letter12 + letter22, false))) {
									const [, , letter32, letter42] = Array.from(word7);
									if (!wordTrie.isPrefix(letter31 + letter32)) {
										continue;
									}
									if (!wordTrie.isPrefix(letter41 + letter42)) {
										continue;
									}
									for (const letter33 of shuffle(hiraganaLetters)) {
										if (!wordTrie.isPrefix(letter13 + letter23 + letter33)) {
											continue;
										}
										if (!wordTrie.isPrefix(letter31 + letter32 + letter33)) {
											continue;
										}
										if (!wordTrie.isPrefix(letter11 + letter22 + letter33)) {
											continue;
										}
										for (const word3 of shuffle(wordTrie.getPrefix(letter31 + letter32 + letter33, false))) {
											const [, , , letter34] = Array.from(word3);
											if (!wordTrie.isPrefix(letter14 + letter24 + letter34)) {
												continue;
											}
											for (const word8 of shuffle(wordTrie.getPrefix(letter13 + letter23 + letter33, false))) {
												const [, , , letter43] = Array.from(word8);
												if (!wordTrie.isPrefix(letter41 + letter42 + letter43)) {
													continue;
												}
												for (const word4 of shuffle(wordTrie.getPrefix(letter14 + letter24 + letter34, false))) {
													const [, , , letter44] = Array.from(word4);
													if (!wordTrie.hasWord(letter11 + letter22 + letter33 + letter44)) {
														continue;
													}
													if (!wordTrie.hasWord(letter41 + letter42 + letter43 + letter44)) {
														continue;
													}
													return {
														letter11, letter12, letter13, letter14,
														letter21, letter22, letter23, letter24,
														letter31, letter32, letter33, letter34,
														letter41, letter42, letter43, letter44,
													};
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
};

export default async () => {
	const {
		letter11, letter12, letter13, letter14,
		letter21, letter22, letter23, letter24,
		letter31, letter32, letter33, letter34,
		letter41, letter42, letter43, letter44,
	} = getBoard();
	const word1 = letter11 + letter12 + letter13 + letter14;
	const word2 = letter21 + letter22 + letter23 + letter24;
	const word3 = letter31 + letter32 + letter33 + letter34;
	const word4 = letter41 + letter42 + letter43 + letter44;
	const word5 = letter11 + letter22 + letter33 + letter44;
	const word6 = letter14 + letter24 + letter34 + letter44;
	const word7 = letter13 + letter23 + letter33 + letter43;
	const word8 = letter12 + letter22 + letter32 + letter42;
	const word9 = letter11 + letter21 + letter31 + letter41;
	const words = [word1, word2, word3, word4, word5, word6, word7, word8, word9];

	const db = await sqlite.open(path.join(__dirname, 'crossword.sqlite3'));
	const descriptions = await Promise.all(words.map((word) => (
		db.get('SELECT * FROM words WHERE ruby = ?', word)
	)));
	return {words, descriptions, board: [
		letter11, letter12, letter13, letter14,
		letter21, letter22, letter23, letter24,
		letter31, letter32, letter33, letter34,
		letter41, letter42, letter43, letter44,
	]};
};
