/* eslint array-plural/array-plural: off */

const qs = require('querystring');
const fs = require('fs');
const path = require('path');
const {JSDOM, VirtualConsole} = require('jsdom');
const {
	RTM_EVENTS: {
		MESSAGE,
	},
} = require('@slack/client');
const {mean, shuffle, range} = require('lodash');
const Cube = require('cubejs');
require('cubejs/lib/solve');

const getParity = (permutation) => {
	const N = permutation.length;
	let parity = 0;

	for (const i of range(N)) {
		for (const j of range(i)) {
			if (permutation[i] < permutation[j]) {
				parity = parity === 0 ? 1 : 0;
			}
		}
	}

	return parity;
};

const shuffleWithParity = (array, indices) => {
	const permutation = shuffle(range(indices.length));
	if (getParity(permutation) === 1) {
		[permutation[0], permutation[1]] = [permutation[1], permutation[0]];
	}

	const clonedArray = array.slice();

	for (const [from, to] of permutation.entries()) {
		clonedArray[indices[to]] = array[indices[from]];
	}
	return clonedArray;
};

Cube.initSolver();

const virtualConsole = new VirtualConsole();
virtualConsole.sendTo(console);

const {window} = new JSDOM('<div id="touch"></div>', {runScripts: 'outside-only', virtualConsole});

window.localStorage = {}; // dummy

for (const scriptPath of [
	'dist/js/jquery.min.js',
	'src/js/mathlib.js',
	'src/js/kernel.js',
	'src/js/tools.js',
	'src/js/tools/cross.js',
]) {
	const script = fs.readFileSync(path.resolve(__dirname, '../lib/cstimer', scriptPath)).toString();
	window.eval(script.replace(/['"]use strict['"];/, '').replace('solve: solve_cross,', 'solve: solve_cross, solve_xcross: solve_xcross,'));
}

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		scrambles: [],
	};

	const getAttachment = (scramble, size) => ({
		title: scramble,
		title_link: `https://alg.cubing.net/?${qs.encode({
			alg: scramble.replace(/'/g, '-').replace(/ /g, '_'),
			view: 'playback',
		})}`,
		image_url: `http://roudai.net/visualcube/visualcube.php?${qs.encode({
			fmt: 'png',
			size,
			sch: 'wrgyob',
			alg: scramble.replace(/ /g, ''),
		})}`,
	});

	const getTimeText = (time) => time === Infinity ? 'DNF' : time.toFixed(2);

	const faceColors = ['#fefe00', '#ffffff', '#ffa100', '#ee0000', '#00d800', '#0000f2'];

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		const {text} = message;

		if (text.startsWith('スクランブル')) {
			const countMatch = text.match(/\d+/);
			const count = countMatch ? Math.min(12, parseInt(countMatch[0])) : 1;

			const scrambles = Array(count).fill().map(() => Cube.scramble());
			state.scrambles = scrambles;

			await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, '', {
				username: 'cubebot',
				icon_url: 'https://i.imgur.com/YyCc0mc.png',
				attachments: scrambles.map((scramble) => getAttachment(scramble, count > 1 ? 80 : 200)),
			});
		}

		if (text === 'クロス') {
			for (const scramble of state.scrambles.slice(0, 5)) {
				const crosses = [];
				const xcrosses = [];

				const div = window.$('<div/>');
				window.cross.solve(scramble, div);

				for (const index of [0, 1, 2, 3, 4, 5]) {
					const solve = div.children().eq(index).text().split(':')[1].trim();
					crosses.push(solve);
				}

				for (const index of [0, 1, 2, 3, 4, 5]) {
					const span = window.$('<span/>');
					window.cross.solve_xcross(window.kernel.parseScramble(scramble, 'FRUBLD'), index, span);
					const solve = span.text().split(':')[1].trim();
					xcrosses.push(solve);
				}

				await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, '', {
					username: 'cubebot',
					icon_url: 'https://i.imgur.com/YyCc0mc.png',
					attachments: [
						getAttachment(scramble, 80),
						...faceColors.map((color, index) => {
							const xcross = xcrosses[index];
							const rotation = xcross.match(/^[xyz]2?'?/);

							return {
								color,
								text: [
									`cross: <https://alg.cubing.net/?${qs.encode({
										setup: (scramble + (rotation ? ` ${rotation[0]}` : '')).replace(/'/g, '-').replace(/ /g, '_'),
										alg: (crosses[index].replace(/^[xyz]2?'? /, '')).replace(/'/g, '-').replace(/ /g, '_'),
										view: 'playback',
									})}|${crosses[index]}>`,
									`x-cross: <https://alg.cubing.net/?${qs.encode({
										setup: (scramble + (rotation ? ` ${rotation[0]}` : '')).replace(/'/g, '-').replace(/ /g, '_'),
										alg: (xcrosses[index].replace(/^[xyz]2?'? /, '')).replace(/'/g, '-').replace(/ /g, '_'),
										view: 'playback',
									})}|${xcrosses[index]}>`,
								].join('\n'),
							};
						}),
					],
				});
			}
		}

		if (text.match(/^\s*(([\d.,]+|DNF)\s*)+$/i)) {
			const times = text.replace(/,/g, '.').split(/\s+/).filter((time) => time.length > 0).map((time) => parseFloat(time) || Infinity);

			if (times.length <= 1) {
				return;
			}

			if (times.length < 5) {
				const timeTexts = times.map((time) => getTimeText(time));

				slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `*${getTimeText(mean(times))}*: ${timeTexts.join(' ')}`, {
					username: 'cubebot',
					icon_url: 'https://i.imgur.com/YyCc0mc.png',
					thread_ts: message.thread_ts,
				});
			} else {
				const maxIndex = times.indexOf(Math.max(...times));
				const minIndex = times.indexOf(Math.min(...times));
				const average = mean(times.filter((time, index) => index !== maxIndex && index !== minIndex));
				const fixedTimes = times.map((time, index) => (index === maxIndex || index === minIndex) ? `(${getTimeText(time)})` : getTimeText(time));

				slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `*${getTimeText(average)}*: ${fixedTimes.join(' ')}`, {
					username: 'cubebot',
					icon_url: 'https://i.imgur.com/YyCc0mc.png',
					thread_ts: message.thread_ts,
				});
			}
		}
	});
};
