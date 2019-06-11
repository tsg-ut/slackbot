const fs = require('fs');
const {chunk, cloneDeep, escapeRegExp, flatten, invert, random, round, sample, shuffle, uniq} = require('lodash');
const path = require('path');
const {promisify} = require('util');

const completeBoards = {
	ahokusa: [
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
	],
	sushi3: [
		[
			':sushi-top-left:',
			':sushi-top-center:',
			':sushi-top-right:',
		],
		[
			':sushi-middle-left:',
			':sushi-middle-center:',
			':sushi-middle-right:',
		],
		[
			':sushi-bottom-left:',
			':sushi-bottom-center:',
			':sushi-bottom-right:',
		],
	],
	sushi4: Array(4).fill().map((_, y) => Array(4).fill().map((_, x) => `:sushi-4-${x}-${y}:`)),
	sushi5: Array(5).fill().map((_, y) => Array(5).fill().map((_, x) => `:sushi-5_${x}_${y}:`)),
	sushi6: Array(6).fill().map((_, y) => Array(6).fill().map((_, x) => `:sushi-6-${x}-${y}:`)),
};

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
			seen: savedState.seen || 0,
			boardName: savedState.boardName || 'ahokusa',
		};
	} catch (e) {
		return {
			board: null,
			startBoard: null,
			hand: 0,
			startDate: null,
			lackedPiece: ':ahokusa-top-center:',
			seen: 0,
			boardName: 'ahokusa',
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

const getBoardSize = (board) => ({
	height: board.length,
	width: board[0].length,
});

const getPiecePosition = (board, piece) => {
	const {height, width} = getBoardSize(board);
	for (let ay = 0; ay < height; ay++) {
		for (let ax = 0; ax < width; ax++) {
			if (board[ay][ax] === piece) {
				return [ax, ay];
			}
		}
	}
	throw new Error('the piece not found');
};

const getMovedBoard = (board, dir) => {
	const {height, width} = getBoardSize(board);
	const [x, y] = getPiecePosition(board, ':void:');
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
	const {height, width} = getBoardSize(board);
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

const isFinishedBoard = (board, completeBoard = completeBoards[state.boardName]) => board.every((row, y) => row.every((cell, x) => (
	cell === completeBoard[y][x] || cell === ':void:'
)));

const getBoardString = (board) => board.map((row) => row.join('')).join('\n');

const reverseDirection = (dir) => ({
	上: '下',
	下: '上',
	左: '右',
	右: '左',
}[dir]);

const ahokusaHandMap = (() => {
	const result = new Map();
	const queue = [];

	const completeBoard = completeBoards.ahokusa;
	const {height, width} = getBoardSize(completeBoard);
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

const isSolvableBoard = (board, completeBoard) => {
	const getParity = (a1, a2_) => {
		const a2 = a2_.slice();
		const inv_a2 = invert(a2);
		const swap_a2 = (i, j) => {
			const tmp = a2[i];
			a2[i] = a2[j];
			a2[j] = tmp;
			inv_a2[a2[i]] = i;
			inv_a2[a2[j]] = j;
		};
		let inversions = 0;
		a1.forEach((elem, i) => {
			if (a2[i] !== elem) {
				const j = inv_a2[elem];
				swap_a2(i, j);
				inversions++;
			}
		});
		return inversions % 2;
	};
	const pieces = flatten(board);
	const lackedPiece = flatten(completeBoard).find((piece) => !pieces.includes(piece));
	const parity = getParity(
		flatten(completeBoard),
		flatten(board).map((piece) => piece === ':void:' ? lackedPiece : piece)
	);

	const [x0, y0] = getPiecePosition(completeBoard, lackedPiece);
	const [x1, y1] = getPiecePosition(board, ':void:');

	return (parity + (x0 - x1) + (y0 - y1)) % 2 === 0;
};

const setNewBoard = async (board, boardName) => {
	const completeBoard = completeBoards[boardName];
	const pieces = flatten(board);
	await setState({
		board,
		startBoard: board,
		boardName,
		hand: 0,
		seen: 0,
		startDate: new Date().valueOf(),
		lackedPiece: flatten(completeBoard).find((piece) => !pieces.includes(piece)),
	});
};

const shuffleBoard = async (boardName) => {
	const completeBoard = completeBoards[boardName];
	const {width} = getBoardSize(completeBoard);
	const brokenPieces = flatten(completeBoard);
	brokenPieces[random(brokenPieces.length - 1)] = ':void:';
	let board = null;
	do {
		board = chunk(shuffle(brokenPieces), width);
	} while (isFinishedBoard(board, completeBoard));
	await setNewBoard(board, boardName);
};

const isValidBoard = (board, completeBoard) => {
	const givenPieces = flatten(board);
	const okPieces = flatten(completeBoard);
	return givenPieces.length === okPieces.length &&
		givenPieces.length === uniq(givenPieces).length &&
		givenPieces.filter((piece) => piece === ':void:').length === 1 &&
		givenPieces.filter((piece) => piece !== ':void:').every((piece) => okPieces.includes(piece));
};

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	rtm.on('message', async (message) => {
		// if (message.channel !== process.env.CHANNEL_SANDBOX) {
		// if (!message.channel.startsWith('D')) {
		if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'ahokusa' || message.username === 'sushi-puzzle') {
			return;
		}

		const postMessage = async (text, opt = {}) => {
			await slack.chat.postMessage({
				channel: message.channel,
				text,
				username: state.boardName === 'ahokusa' ? 'ahokusa' : 'sushi-puzzle',
				icon_emoji: state.lackedPiece,
				...opt,
			});
		};

		const postBoard = async () => {
			const boardText = getBoardString(state.board);
			await postMessage(boardText);
		};

		if (message.text === 'あほくさスライドパズル') {
			await shuffleBoard('ahokusa');
			await postBoard();
			return;
		}

		if (message.text === '寿司スライドパズル') {
			await shuffleBoard(sample(['sushi3', 'sushi4', 'sushi5', 'sushi6']));
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
			const postAsAhokusa = (text, opt = {}) => (
				postMessage(text, {
					username: 'ahokusa',
					...(state.boardName === 'ahokusa' ? {} : {icon_emoji: ':ahokusa-top-center:'}),
					...opt,
				})
			);

			if (command === 'ヒント') {
				if (state.board === null || state.boardName !== 'ahokusa') {
					await postAsAhokusa(':ha:');
					return;
				}
				const boardStr = getBoardString(state.board);
				if (ahokusaHandMap.has(boardStr)) {
					const [hand, dirs] = ahokusaHandMap.get(boardStr);
					await postAsAhokusa(`残り最短${hand}手: ${dirs.join(' or ')}`);
				} else {
					await postAsAhokusa('残り最短∞手');
				}
				return;
			}

			const completeBoard = completeBoards.ahokusa;
			if (new RegExp(
				`^((${flatten(completeBoard).map((str) => escapeRegExp(str)).join('|')}|:void:)\\s*)+$`
			).test(command)) {
				const {width} = getBoardSize(completeBoard);
				const board = chunk(command.match(new RegExp(`${flatten(completeBoard).map((str) => escapeRegExp(str)).join('|')}|:void:`, 'g')), width);
				if (!isValidBoard(board, completeBoard) || isFinishedBoard(board, completeBoard)) {
					await postAsAhokusa(':ha:');
					return;
				}
				await setNewBoard(board, 'ahokusa');
				await postBoard();
				return;
			}

			if ((/^([あほくさ_#.]\s*)+$/).test(command)) {
				const {width} = getBoardSize(completeBoard);
				const board = chunk(command.match(/[あほくさ_#.]/g).map((c) => ({
					あ: ':ahokusa-top-right:',
					ほ: ':ahokusa-bottom-right:',
					く: ':ahokusa-top-left:',
					さ: ':ahokusa-bottom-left:',
					_: ':ahokusa-top-center:',
					'#': ':ahokusa-bottom-center:',
					'.': ':void:',
				}[c])), width);
				if (!isValidBoard(board, completeBoard) || isFinishedBoard(board, completeBoard)) {
					await postAsAhokusa(':ha:');
					return;
				}
				await setNewBoard(board, 'ahokusa');
				await postBoard();
				return;
			}
			await postAsAhokusa(':ha:');
			return;
		}

		if (message.text === '不成立') {
			if (state.board === null) {
				await postMessage(':ha:');
				return;
			}

			if (isSolvableBoard(state.startBoard, completeBoards[state.boardName])) {
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
				let minHandInfo = '';
				if (state.boardName === 'ahokusa') {
					 const minHand = ahokusaHandMap.get(getBoardString(state.startBoard))[0];
					 minHandInfo = `（${state.hand === minHand ? ':tada:最短' : `最短：${minHand}手`}）`;
				}
				await postMessage(
					`:tada: ${round(time, 2).toFixed(2)}秒、` +
					`${state.hand}手${minHandInfo}` +
					`${state.seen === 1 ? '、一発' : ''}`
				);
				await setState({
					board: null,
				});
			}
		}
	});
};
