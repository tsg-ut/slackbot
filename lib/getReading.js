const {tokenize} = require('kuromojin');
const toJapanese = require('jp-num/toJapanese');
const iconv = require('iconv-lite');
const {toZenKana} = require('jaconv');
const path = require('path');
const fs = require('fs');
const download = require('download');
const {promisify} = require('util');
const {escapeRegExp} = require('lodash');
const {katakanize} = require('japanese');

const loadingPromise = async () => {
	const englishDictPath = path.resolve(__dirname, 'bep-ss-2.3', 'bep-eng.dic');

	const englishDictExists = await new Promise((resolve) => {
		fs.access(englishDictPath, fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	});

	if (!englishDictExists) {
		await download('http://www.argv.org/bep/files/linux/beta/bep-ss-2.3.tar.gz', __dirname, {extract: true});
	}

	const englishDictBuffer = await promisify(fs.readFile)(englishDictPath);
	const englishDictText = iconv.decode(englishDictBuffer, 'sjis');
	const englishDict = new Map([
		...englishDictText
			.split('\n')
			.map((line) => {
				const [english, japanese] = line.split(' ');
				if (!japanese) {
					return null;
				}
				return [english.toLowerCase(), toZenKana(japanese).replace(/ゥ$/, '')];
			})
			.filter((entry) => entry),
		['a', 'えー'],
		['b', 'びー'],
		['c', 'しー'],
		['d', 'でぃー'],
		['e', 'いー'],
		['f', 'えふ'],
		['g', 'じー'],
		['h', 'えいち'],
		['i', 'あい'],
		['j', 'じぇい'],
		['k', 'けい'],
		['l', 'える'],
		['m', 'えむ'],
		['n', 'えぬ'],
		['o', 'おー'],
		['p', 'ぴー'],
		['q', 'きゅー'],
		['r', 'あーる'],
		['s', 'えす'],
		['t', 'てぃー'],
		['u', 'ゆー'],
		['v', 'ぶい'],
		['w', 'だぶりゅー'],
		['x', 'えっくす'],
		['y', 'わい'],
		['z', 'ずぃー'],
	]);
	const englishDictRegex = new RegExp(
		`\\b(${Array.from(englishDict.keys())
			.map((word) => escapeRegExp(word))
			.join('|')})\\b`,
		'gi'
	);
	return {
		englishDict,
	};
};

const kanizeEnglish = async (word_) => {
	const {englishDict} = await loadingPromise();

	const genLattice = (word) => {
		// eslint-disable-next-line array-plural/array-plural
		const dp = Array(word.length).fill().map(() => Array(word.length).fill());
		const rec = (a, b) => {
			if (b === word.length) {
				return {to: [], range: [a, b], eos: true};
			}
			if (dp[a][b]) {
				return dp[a][b];
			}
			const node = {to: [], range: [a, b], eos: false};
			for (let i = 0; i < word.length - b; ++i) {
				if (englishDict.has(word.substring(b, b + i + 1))) {
					const node2 = rec(b, b + i + 1);
					if (node2.to || node2.eos) {
						node.to.push(node2);
					}
				}
			}
			dp[a][b] = node;
			return node;
		};
		return rec(0, 0);
	};
	const findShortestPath = (word) => {
		// eslint-disable-next-line array-plural/array-plural
		const nodeQueue = [{words: [], node: genLattice(word)}];
		while (true) {
			const {node, words} = nodeQueue.shift();
			if (node.eos) {
				return words.concat([node.range]);
			}
			for (const n of node.to) {
				nodeQueue.push({words: words.concat([node.range]), node: n});
			}
		}
	};

	return findShortestPath(word_.toLowerCase())
		.slice(1)
		.map(([a, b]) => englishDict.get(word_.toLowerCase().substring(a, b)))
		.join('');
};

module.exports = async (text) => {
	const englishWords = text.match(/[a-zA-Z]+/g) || [];
	const readingMap = new Map(await Promise.all(englishWords.map(async (word) => {
		const reading = await kanizeEnglish(word);
		return [word, reading];
	})))
	const normalizedText = text.replace(/[a-zA-Z]+/g, (english) => readingMap.get(english) || english);
	const tokens = await tokenize(normalizedText.replace(/[\d,]+/g, (number) => toJapanese(number.replace(/,/g, ''))));
	const reading = Array.from(katakanize(tokens.map(({reading: read, surface_form}) => read || surface_form || '').join('')))
		.join('')
		.replace(/\P{Script_Extensions=Katakana}/gu, '');
	return toZenKana(reading);
}
