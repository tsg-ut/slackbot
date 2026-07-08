import fs from 'fs';
import iconv from 'iconv-lite';
// @ts-expect-error
import {toZenKana} from 'jaconv';
// @ts-expect-error
import {katakanize, romanizationTable, defaultRomanizationConfig} from 'japanese';
// @ts-expect-error
import toJapanese from 'jp-num/toJapanese.js';
import {tokenize} from 'kuromojin';
import {escapeRegExp} from 'lodash-es';
import path from 'path';
import {promisify} from 'util';
import getReading from '../lib/getReading';

const loadingPromise = (async () => {
	// ensure the dictionary file is downloaded (は？)
	await getReading('sushi');

	const englishDictPath = path.resolve(import.meta.dirname, '..', 'lib', 'bep-ss-2.3', 'bep-eng.dic');
	const englishDictBuffer = await promisify(fs.readFile)(englishDictPath);
	const englishDictText = iconv.decode(englishDictBuffer, 'sjis');
	const englishDict = new Map<string, string>([
		...[
			...Object.entries(romanizationTable),
			...Object.entries(defaultRomanizationConfig),
		].reverse().map(([kana, romaji]): [string, string] => [romaji as string, katakanize(kana) as string]),
		...englishDictText
			.split('\n')
			.map((line) => {
				const [english, japanese] = line.split(' ');
				if (!english || !japanese) {
					return null;
				}
				return [english.toLowerCase(), toZenKana(japanese).replace(/([トド])ゥ$/, '$1')] as [string, string];
			})
			.filter((entry): entry is [string, string] => entry !== null),

		['dajare', 'だじゃれ'],
		['tahoiya', 'たほいや'],
		['pocky', 'ぽっきー'],

		['a', 'エー'],
		['b', 'ビー'],
		['c', 'シー'],
		['d', 'ディー'],
		['e', 'イー'],
		['f', 'エフ'],
		['g', 'ジー'],
		['h', 'エイチ'],
		['i', 'アイ'],
		['j', 'ジェー'],
		['k', 'ケー'],
		['l', 'エル'],
		['m', 'エム'],
		['n', 'エヌ'],
		['o', 'オー'],
		['p', 'ピー'],
		['q', 'キュー'],
		['r', 'アール'],
		['s', 'エス'],
		['t', 'ティー'],
		['u', 'ユー'],
		['v', 'ブイ'],
		['w', 'ダブリュー'],
		['x', 'エックス'],
		['y', 'ワイ'],
		['z', 'ズィー'],
	]);
	const englishDictRegex = new RegExp(
		`(${Array.from(englishDict.keys())
			.sort((a, b) => b.length - a.length)
			.map((word) => escapeRegExp(word))
			.join('|')})`,
		'gi'
	);

	const numberToJapanese = (number: string) => {
		if ((/^0\d/).test(number)) {
			return number.split('').map((num) => toJapanese(num)).join('');
		}
		return toJapanese(number);
	};

	const preprocessText = (text: string) => text
		.replace(englishDictRegex, (english) => ` ${englishDict.get(english.toLowerCase()) || english} `)
		.replace(/\s{2,}/gu, ' ')
		.replace(/\d+/g, (number) => (number.length <= 8 ? numberToJapanese(number) : number))
		.replace(/〜/g, 'ー')
		.trim();

	return {preprocessText};
})();

export default async (text: string) => {
	const {preprocessText} = await loadingPromise;
	const pText = preprocessText(text);
	return tokenize(pText);
};
