const fs = require('fs');
const iconv = require('iconv-lite');
const {toZenKana} = require('jaconv');
const {katakanize, romanizationTable, defaultRomanizationConfig} = require('japanese');
const toJapanese = require('jp-num/toJapanese');
const {tokenize} = require('kuromojin');
const {escapeRegExp} = require('lodash');
const path = require('path');
const {promisify} = require('util');

const getReading = require('../lib/getReading');

// dajare/index.jsからrequireされた時点ではなく、実際に辞書が必要になるまで
// (tokenize()が最初に呼ばれるまで)読み込みを遅延する。lib/utils.tsのLoaderと
// 同じ「初回呼び出し時のみ実行してキャッシュする」パターンだが、CJSモジュール
// からvite-node経由で拡張子なしの.tsファイルをrequireするとMODULE_NOT_FOUNDに
// なる(anime/hangmanと同種の制約)ため、ここでは直接requireせず同等のロジックを
// このファイル内に実装している。
let loadingPromise = null;
const load = () => {
	if (loadingPromise) {
		return loadingPromise;
	}
	loadingPromise = (async () => {
		// ensure the dictionary file is downloaded (は？)
		await getReading('sushi');

		const englishDictPath = path.resolve(__dirname, '..', 'lib', 'bep-ss-2.3', 'bep-eng.dic');
		const englishDictBuffer = await promisify(fs.readFile)(englishDictPath);
		const englishDictText = iconv.decode(englishDictBuffer, 'sjis');
		const englishDict = new Map([
			...[
				...Object.entries(romanizationTable),
				...Object.entries(defaultRomanizationConfig),
			].reverse().map(([kana, romaji]) => [romaji, katakanize(kana)]),
			...englishDictText
				.split('\n')
				.map((line) => {
					const [english, japanese] = line.split(' ');
					if (!english || !japanese) {
						return null;
					}
					return [english.toLowerCase(), toZenKana(japanese).replace(/([トド])ゥ$/, '$1')];
				})
				.filter((entry) => entry),

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

		const numberToJapanese = (number) => {
			if ((/^0\d/).test(number)) {
				return number.split('').map((num) => toJapanese(num)).join('');
			}
			return toJapanese(number);
		};

		const preprocessText = (text) => text
			.replace(englishDictRegex, (english) => ` ${englishDict.get(english.toLowerCase()) || english} `)
			.replace(/\s{2,}/gu, ' ')
			.replace(/\d+/g, (number) => (number.length <= 8 ? numberToJapanese(number) : number))
			.replace(/〜/g, 'ー')
			.trim();

		return {preprocessText};
	})();
	return loadingPromise;
};

module.exports = async (text) => {
	const {preprocessText} = await load();
	const pText = preprocessText(text);
	return tokenize(pText);
};
