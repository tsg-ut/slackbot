const fs = require('fs');
const {chunk, cloneDeep, escapeRegExp, flatten, random, round, shuffle, uniq} = require('lodash');
const path = require('path');
const {promisify} = require('util');

const state = (() => {
	try {
		// eslint-disable-next-line global-require
		const savedState = require('./state.json');
		return {
			board: savedState.board || null,
			startBoard: savedState.startBoard || null,
			hand: savedState.hand || 0,
			startDate: savedState.startDate || null,
			lackedPiece: savedState.lackedPiece || ':ahokusa-top-center:',
		};
	} catch (e) {
		return {
			board: null,
			startBoard: null,
			hand: 0,
			startDate: null,
			lackedPiece: ':ahokusa-top-center:',
			seen: 0,
		};
	}
})();

const setState = async (newState) => {
	Object.assign(state, newState);

	const savedState = {};
	for (const [key, value] of Object.entries(state)) {
		savedState[key] = value;
	}

	await promisify(fs.writeFile)(
		path.join(__dirname, 'state.json'),
		JSON.stringify(savedState)
	);
};

const completeBoard = [
	[
		':ahokusa-top-left:',
		':ahokusa-top-center:',
		':ahokusa-top-right:',
	],
	[
		':ahokusa-bottom-left:',
		':ahokusa-bottom-center:',
		':ahokusa-bottom-right:',
	],
];
const height = completeBoard.length;
const width = completeBoard[0].length;

const getMovedBoard = (board, dir) => {
	const [x, y] = (() => {
		for (let ay = 0; ay < height; ay++) {
			for (let ax = 0; ax < width; ax++) {
				if (board[ay][ax] === ':void:') {
					return [ax, ay];
				}
			}
		}
		throw new Error(':void: not found');
	})();
	const [dx, dy] = {
		上: [0, -1],
		下: [0, 1],
		左: [-1, 0],
		右: [1, 0],
	}[dir];
	const nx = x - dx;
	const ny = y - dy;
	if (nx < 0 || width <= nx || ny < 0 || height <= ny) {
		throw new Error(':ha:');
	}
	const newBoard = cloneDeep(board);
	newBoard[y][x] = newBoard[ny][nx];
	newBoard[ny][nx] = ':void:';
	return newBoard;
};

const move = async (text) => {
	let {board, hand} = state;
	for (let matchArray, re = /([上下左右])(\d*)/g; (matchArray = re.exec(text));) {
		const dir = matchArray[1];
		const amount = parseInt(matchArray[2] || '1');
		if (amount === 0 || (amount >= width && amount >= height)) {
			throw new Error(':ha:');
		}
		for (let i = 0; i < amount; i++) {
			board = getMovedBoard(board, dir);
			hand++;
		}
	}
	await setState({board, hand, seen: state.seen + 1});
};

const isFinishedBoard = (board) => board.every((row, y) => row.every((cell, x) => (
	cell === completeBoard[y][x] || cell === ':void:'
)));

const getBoardString = (board) => board.map((row) => row.join('')).join('\n');

const reverseDirection = (dir) => ({
	上: '下',
	下: '上',
	左: '右',
	右: '左',
}[dir]);

const handMap = (() => {
	const result = new Map();
	const queue = [];

	for (let i = 0; i < height * width; i++) {
		const brokenPieces = flatten(completeBoard);
		brokenPieces[i] = ':void:';
		const brokenBoard = chunk(brokenPieces, width);
		result.set(getBoardString(brokenBoard), [0, []]);
		queue.push(brokenBoard);
	}
	while (queue.length) {
		const board = queue.shift();
		const boardStr = getBoardString(board);
		for (const dir of ['上', '下', '左', '右']) {
			let newBoard = null;
			try {
				newBoard = getMovedBoard(board, dir);
			} catch (e) {
				if (e.message === ':ha:') {
					continue;
				}
				throw e;
			}
			const newBoardStr = getBoardString(newBoard);
			if (result.has(newBoardStr)) {
				const [hand, dirs] = result.get(newBoardStr);
				if (hand === result.get(boardStr)[0] + 1) {
					dirs.push(reverseDirection(dir));
				}
			} else {
				result.set(newBoardStr, [result.get(boardStr)[0] + 1, [reverseDirection(dir)]]);
				queue.push(newBoard);
			}
		}
	}
	return result;
})();

const setNewBoard = async (board) => {
	const pieces = flatten(board);
	await setState({
		board,
		startBoard: board,
		hand: 0,
		seen: 0,
		startDate: new Date().valueOf(),
		lackedPiece: flatten(completeBoard).find((piece) => !pieces.includes(piece)),
	});
};

const shuffleBoard = async () => {
	const brokenPieces = flatten(completeBoard);
	brokenPieces[random(brokenPieces.length - 1)] = ':void:';
	let board = null;
	do {
		board = chunk(shuffle(brokenPieces), width);
	} while (isFinishedBoard(board));
	await setNewBoard(board);
};

const isValidBoard = (board) => {
	const givenPieces = flatten(board);
	const okPieces = flatten(completeBoard);
	return givenPieces.length === okPieces.length &&
		givenPieces.length === uniq(givenPieces).length &&
		givenPieces.filter((piece) => piece === ':void:').length === 1 &&
		givenPieces.filter((piece) => piece !== ':void:').every((piece) => okPieces.includes(piece));
};

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
		// if (!message.channel.startsWith('D')) {
		// if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'ahokusa') {
			return;
		}

		const postMessage = async (text) => {
			await slack.chat.postMessage({
				channel: message.channel,
				text,
				username: 'ahokusa',
				icon_emoji: state.lackedPiece,
			});
		};

		const postBoard = async () => {
			const boardText = getBoardString(state.board);
			await postMessage(boardText);
		};

		if (message.text === 'あほくさスライドパズル') {
			await shuffleBoard();
			await postBoard();
			return;
		}

		if (message.text === 'もう一度') {
			if (state.startBoard === null) {
				await postMessage(':ha:');
				return;
			}
			await setState({
				board: state.startBoard,
				hand: 0,
				seen: 0,
			});
			await postBoard();
			return;
		}

		if ((/^@ahokusa\b/).test(message.text)) {
			const command = message.text.replace(/^@ahokusa\s*/, '');

			if (command === 'ヒント') {
				if (state.board === null) {
					await postMessage(':ha:');
					return;
				}
				const boardStr = getBoardString(state.board);
				if (handMap.has(boardStr)) {
					const [hand, dirs] = handMap.get(boardStr);
					await postMessage(`残り最短${hand}手: ${dirs.join(' or ')}`);
				} else {
					await postMessage('残り最短∞手');
				}
				return;
			}

			if (new RegExp(
				`^((${flatten(completeBoard).map((str) => escapeRegExp(str)).join('|')}|:void:)\\s*)+$`
			).test(command)) {
				const board = chunk(command.match(new RegExp(`${flatten(completeBoard).map((str) => escapeRegExp(str)).join('|')}|:void:`, 'g')), width);
				if (!isValidBoard(board) || isFinishedBoard(board)) {
					await postMessage(':ha:');
					return;
				}
				await setNewBoard(board);
				await postBoard();
				return;
			}

			if ((/^([あほくさ_#.]\s*)+$/).test(command)) {
				const board = chunk(command.match(/[あほくさ_#.]/g).map((c) => ({
					あ: ':ahokusa-top-right:',
					ほ: ':ahokusa-bottom-right:',
					く: ':ahokusa-top-left:',
					さ: ':ahokusa-bottom-left:',
					_: ':ahokusa-top-center:',
					'#': ':ahokusa-bottom-center:',
					'.': ':void:',
				}[c])), width);
				if (!isValidBoard(board) || isFinishedBoard(board)) {
					await postMessage(':ha:');
					return;
				}
				await setNewBoard(board);
				await postBoard();
				return;
			}
			await postMessage(':ha:');
			return;
		}

		if (message.text === '不成立') {
			if (state.board === null) {
				await postMessage(':ha:');
				return;
			}

			if (handMap.has(getBoardString(state.startBoard))) {
				await postMessage(':seyaroka: ペナルティ: +5秒');
				await setState({
					startDate: state.startDate - 5000,
				});
			} else {
				const time = (new Date().valueOf() - state.startDate) / 1000;
				await slack.reactions.add({
					name: 'seyana',
					channel: message.channel,
					timestamp: message.ts,
				});
				await postMessage(
					`:tada: ${round(time, 2).toFixed(2)}秒` +
					`${state.seen === 0 ? '、一発' : ''}`
				);
				await setState({
					board: null,
				});
			}
			return;
		}

		if ((/^([上下左右]\d*)+$/).test(message.text)) {
			if (state.board === null) {
				return;
			}
			try {
				await move(message.text);
			} catch (e) {
				if (e.message === ':ha:') {
					await postMessage(e.message);
					return;
				}
				throw e;
			}
			await postBoard();
			if (isFinishedBoard(state.board)) {
				const time = (new Date().valueOf() - state.startDate) / 1000;
				const minHand = handMap.get(getBoardString(state.startBoard))[0];
				await postMessage(
					`:tada: ${round(time, 2).toFixed(2)}秒、` +
					`${state.hand}手（${state.hand === minHand ? ':tada:最短' : `最短：${minHand}手`}）` +
					`${state.seen === 1 ? '、一発' : ''}`
				);
				await setState({
					board: null,
				});
			}
		}
	});
};

module.exports.handMap = handMap;
