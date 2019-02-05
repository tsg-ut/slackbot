const {flatten, uniqBy} = require('lodash');

const isGoodWord = (text) => !(/^[ァィゥェォッャュョヮンー]/).test(text);

/**
 * @description Generate cartesian product of arrays
 * @template T
 * @param {Array<Iterable<T>>} arrays List of input array
 * @returns {IterableIterator<Array<T>>} A generator yielding result array
 */
const product = function* product(...arrays) {
	if (arrays.length === 0) {
		yield [];
		return;
	}
	for (const head of product(...arrays.slice(0, -1))) {
		for (const last of arrays.slice(-1)[0]) {
			yield [...head, last];
		}
	}
};

// - ヂヅヲをジズオにする
// - 促音を保持,省略
// - 拗音・促音を保持,大きくする
// - 長音符を残す,展開,省略
// - 撥音を残す,省略
// 1*2*2*3*2 = 24通り
const substRulesList = Array.from(product(
	[
		[
			[/ヂ/g, 'ジ'],
			[/ヅ/g, 'ズ'],
			[/ヲ/g, 'オ'],
		],
	],
	[
		[],
		[
			[/ッ/g, ''],
		],
	],
	[
		[],
		[
			[/[ァィゥェォッャュョヮ]/g, (char) => String.fromCodePoint(char.codePointAt(0) + 1)],
		],
	],
	[
		[],
		[
			[/([アカサタナハマヤラワガザダバパヷァャヮ])ー/g, '$1ア'],
			[/([イキシチニヒミイリヰギジヂビピヸィ])ー/g, '$1イ'],
			[/([ウクスツヌフムユルウグズヅブプヴゥュ])ー/g, '$1ウ'],
			[/([エケセテネヘメエレヱゲゼデベペヹェ])ー/g, '$1エ'],
			[/([オコソトノホモヨロヲゴゾドボポヺォョ])ー/g, '$1ウ'],
			[/([ン])ー/g, '$1ン'],
		],
		[
			[/ー/g, ''],
		],
	],
	[
		[],
		[
			[/ン/g, ''],
		],
	],
), (rules) => flatten(rules));

module.exports = {
	findDajare(text, lim = 2) {
		if (text.length < lim * 2) {
			return null;
		}

		/** @type {Map<string, number[]>} */
		let map = new Map();
		for (let i = 0; i <= text.length - lim; i++) {
			const target = text.substr(i, lim);
			if (!isGoodWord(target)) {
				continue;
			}
			if (!map.has(target)) {
				map.set(target, []);
			}
			map.get(target).push(i);
		}

		const isGoodIndices = (indices, length) => (
			indices.length >= 2 &&
			(indices.slice(-1)[0] - indices[0]) >= length
		);
		const getNonOverlappingIndices = (indices, length) => {
			if (indices.length === 0) {
				return [];
			}
			let lastIndex = indices[0];
			const resultIndices = [lastIndex];
			for (let i = 1; i < indices.length; i++) {
				const index = indices[i];
				if (lastIndex + length > index) {
					// overlap
					continue;
				}
				resultIndices.push(index);
				lastIndex = index;
			}
			return resultIndices;
		};

		for (let len = lim + 1; len <= text.length / 2; len++) {
			//
			/** @type {Map<string, number[]>} */
			const newMap = new Map();
			for (const [, indices] of map) {
				if (!isGoodIndices(indices, len)) {
					continue;
				}
				for (const i of indices) {
					const target = text.substr(i, len);
					if (!newMap.has(target)) {
						newMap.set(target, []);
					}
					newMap.get(target).push(i);
				}
			}
			if ([...newMap].every(([, indices]) => !isGoodIndices(indices, len))) {
				break;
			}
			map = newMap;
		}
		for (const [word, indices] of map) {
			const nonOverlappingIndices = getNonOverlappingIndices(indices, word.length);
			if (nonOverlappingIndices.length < 2) {
				continue;
			}
			return {
				word,
				indices: nonOverlappingIndices,
			};
		}
		return null;
	},
	listAlternativeReadings(readings) {
		const altReadings = substRulesList.map((rules) => readings.map((reading) => {
			let result = reading;
			for (const [regexp, repl] of rules) {
				result = result.replace(regexp, repl);
			}
			return result;
		}));
		return uniqBy(altReadings, (altReading) => altReading.join(''));
	},
};
