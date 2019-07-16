const {default: Shogi} = require('shogi9.js');
const {default: Color} = require('shogi9.js/lib/Color.js');
const {default: Piece} = require('shogi9.js/lib/Piece.js');
const sqlite = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const assert = require('assert');
const minBy = require('lodash/minBy');
const maxBy = require('lodash/maxBy');
const sample = require('lodash/sample');
const last = require('lodash/last');
const flatten = require('lodash/flatten');
const oneLine = require('common-tags/lib/oneLine');
const {unlock, increment} = require('../achievements/index.ts');

const {
	serialize,
	deserialize,
	getTransitions,
	charToPiece,
	pieceToChar,
	transitionToText,
} = require('./util.js');
const {upload} = require('./image.js');

const iconUrl =
	'https://2.bp.blogspot.com/-UT3sRYCqmLg/WerKjjCzRGI/AAAAAAABHpE/kenNldpvFDI6baHIW0XnB6JzITdh3hB2gCLcBGAs/s400/character_game_syougi.png';

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		previousPosition: null,
		previousBoard: new Shogi({
			preset: 'OTHER',
			data: {
				color: Color.Black,
				board: [[{}, {}, {}], [{}, {}, {}], [{}, {}, {}]],
				hands: [
					{HI: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, FU: 0},
					{HI: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, FU: 0},
				],
			},
		}),
		previousDatabase: '245.sqlite3',
		previousTurns: 7,
		isPrevious打ち歩: false,
		isRepetitive: false,
		isLocked: false,
		isEnded: false,
		player: null,
		board: null,
		turn: null,
		log: [],
		thread: null,
		flags: new Set(),
	};

	let match = null;

	const perdon = async (description = '') => {
		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: ':ha:',
			username: 'shogi',
			icon_url: iconUrl,
			thread_ts: state.thread,
		});
		if (description !== '') {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `${description}:korosuzo:`,
				username: 'shogi',
				icon_url: iconUrl,
				thread_ts: state.thread,
			});
		}
	};

	const post = async (message, {mode = 'thread'} = {}) => {
		const imageUrl = await upload(state.board);
		return slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: message,
			username: 'shogi',
			icon_url: iconUrl,
			attachments: [
				{
					image_url: imageUrl,
					fallback: state.board.toSFENString(),
				},
			],
			thread_ts: state.thread,
			...(mode === 'broadcast' ? {reply_broadcast: true} : {}),
		});
	};

	const end = async (color, reason) => {
		console.log(state);
		const {log, isEnded} = state;
		state.previousPosition = null;
		state.board = null;
		state.turn = null;
		state.log = [];
		state.isEnded = true;

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const player =
			color === Color.Black
				? `先手<@${state.player}>`
				: '後手9マスしょうぎ名人';
		const message = `まで、${log.length}手で${player}の勝ちです。${
			reason ? `(${reason})` : ''
		}`;

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: message,
			username: 'shogi',
			icon_url: iconUrl,
			thread_ts: state.thread,
			reply_broadcast: true,
		});

		if (log.length === state.previousTurns) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: '最短勝利:tada:',
				username: 'shogi',
				icon_url: iconUrl,
				thread_ts: state.thread,
				reply_broadcast: true,
			});
		}

		if (reason === '打ち歩詰め') {
			await unlock(state.player, 'shogi-打ち歩詰め');
		}
		if (color === Color.Black) {
			await unlock(state.player, 'shogi');
			if (log.length === state.previousTurns) {
				await unlock(state.player, 'shogi-shortest');
				if (!isEnded) {
					await unlock(state.player, 'shogi-shortest-without-end');
				}
				if (!state.isRepetitive && state.previousTurns >= 7) {
					await increment(state.player, 'shogiWin');
				}
				if (state.previousTurns >= 11) {
					await unlock(state.player, 'shogi-over11');
				}
				if (state.previousTurns >= 19) {
					await unlock(state.player, 'shogi-over19');
					if (!isEnded) {
						await unlock(state.player, 'shogi-over19-without-end');
					}
				}
				if (state.previousTurns >= 7) {
					if (state.flags.has('銀不成')) {
						await unlock(state.player, 'shogi-銀不成');
					}
					if (state.flags.has('自陣飛車')) {
						await unlock(state.player, 'shogi-自陣飛車');
					}
					if (state.flags.has('自陣角')) {
						await unlock(state.player, 'shogi-自陣角');
					}
					if (state.flags.has('歩成')) {
						await unlock(state.player, 'shogi-歩成');
					}
					if (state.flags.has('三桂')) {
						await unlock(state.player, 'shogi-三桂');
					}
				}
			}
		}
	};

	const aiTurn = async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const inversedBoard = state.board.inverse();

		const currentResult = await sqlite.get(
			oneLine`
				SELECT board, result, depth
				FROM boards
				WHERE board = ?
			`,
			serialize(inversedBoard)
		);

		// 先手自殺手
		if (!currentResult) {
			end(Color.White, '王手放置');
			return;
		}

		// 後手詰み
		if (currentResult.depth === 1) {
			if (state.isPrevious打ち歩) {
				end(Color.White, '打ち歩詰め');
				return;
			}

			end(Color.Black);
			return;
		}

		const transitions = getTransitions(inversedBoard);

		const transitionResults = await sqlite.all(
			oneLine`
				SELECT board, result, depth
				FROM boards
				WHERE board IN (${Array(transitions.length)
		.fill('?')
		.join(', ')})
				ORDER BY RANDOM()
			`,
			transitions.map((transition) => serialize(transition.board))
		);

		const loseResults = transitionResults.filter(({result}) => result === 0);
		const winResults = transitionResults.filter(({result}) => result === 1);
		const unknownResults = transitionResults.filter(
			({result}) => result === null
		);
		state.isPrevious打ち歩 = false;

		if (loseResults.length > 0) {
			const transitionResult = minBy(loseResults, 'depth');
			const transition = transitions.find(
				({board}) => Buffer.compare(serialize(board), transitionResult.board) === 0
			);
			state.board = deserialize(transitionResult.board);
			state.turn = Color.Black;
			const logText = transitionToText(
				transition,
				Color.White,
				state.previousPosition
			);
			state.previousPosition = {
				x: 4 - transition.data.to.x,
				y: 4 - transition.data.to.y,
			};
			state.log.push(logText);
			await post(logText);

			// 先手詰み
			if (transitionResult.depth === 1) {
				end(Color.White);
			}
		} else {
			const transitionResult =
				unknownResults.length > 0
					? sample(unknownResults)
					: maxBy(winResults, 'depth');
			const transition = transitions.find(
				({board}) => Buffer.compare(serialize(board), transitionResult.board) === 0
			);
			state.board = deserialize(transitionResult.board);
			state.turn = Color.Black;
			const logText = transitionToText(
				transition,
				Color.White,
				state.previousPosition
			);
			state.previousPosition = {
				x: 4 - transition.data.to.x,
				y: 4 - transition.data.to.y,
			};
			state.log.push(logText);
			await post(logText);
		}
	};

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'shogi') {
			return;
		}

		const {text, ts} = message;

		if (
			text === '将棋' ||
			text.match(/^\d+手(?:詰め|必勝将棋)$/) ||
			text.match(/^\d+手以上(?:詰め|必勝将棋)$/)
		) {
			if (state.board !== null || state.isLocked) {
				perdon();
				return;
			}

			let matches = null;
			let condition = '';
			if ((matches = text.match(/^(?<count>\d+)手(?:詰め|必勝将棋)$/))) {
				condition = `depth = ${(parseInt(
					matches.groups.count.replace(/^0+/, '')
				) || 0) + 1}`;
			} else if (
				(matches = text.match(/^(?<count>\d+)手以上(?:詰め|必勝将棋)$/))
			) {
				condition = `depth > ${parseInt(
					matches.groups.count.replace(/^0+/, '')
				) || 0}`;
			} else {
				condition = 'depth > 5';
			}

			const databases = await fs.readdir(path.resolve(__dirname, 'boards'));
			const database = sample(databases);
			await sqlite.open(path.resolve(__dirname, 'boards', database));
			const data = await sqlite.get(oneLine`
				SELECT *
				FROM boards
				WHERE result = 1 AND ${condition}
				ORDER BY is_good DESC, RANDOM()
				LIMIT 1
			`);
			if (data === undefined) {
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: ':thinking_face:',
					username: 'shogi',
					icon_url: iconUrl,
				});
				return;
			}
			state.previousDatabase = database;
			state.board = deserialize(data.board);
			state.previousBoard = state.board.clone();
			state.previousTurns = data.depth - 1;
			state.isPrevious打ち歩 = false;
			state.isRepetitive = false;
			state.isEnded = false;
			state.turn = Color.Black;
			state.player = message.user;
			state.flags = new Set();
			state.thread = ts;

			const 桂馬count = flatten([
				...state.board.board,
				state.board.hands[0],
			]).filter((piece) => piece && piece.color === Color.Black && piece.kind === 'KE').length;
			if (桂馬count >= 3) {
				state.flags.add('三桂');
			}

			await post(`${data.depth - 1}手必勝`, {mode: 'broadcast'});
			return;
		}

		if (
			message.thread_ts &&
			state.thread === message.thread_ts &&
			text === 'もう一回'
		) {
			if (state.previousBoard === null || state.isLocked) {
				perdon();
				return;
			}

			if (state.board !== null) {
				await end(Color.White);
			}

			await sqlite.open(
				path.resolve(__dirname, 'boards', state.previousDatabase)
			);
			state.board = state.previousBoard;
			state.previousBoard = state.board.clone();
			state.isPrevious打ち歩 = false;
			state.isRepetitive = true;
			state.turn = Color.Black;
			state.player = message.user;
			state.flags = new Set();

			const 桂馬count = flatten([
				...state.board.board,
				state.board.hands[0],
			]).filter((piece) => piece && piece.color === Color.Black && piece.kind === 'KE').length;
			if (桂馬count >= 3) {
				state.flags.add('三桂');
			}

			await post(`もう一回 (${state.previousTurns}手必勝)`);
			return;
		}

		if (
			message.thread_ts &&
			state.thread === message.thread_ts &&
			text === '正着手'
		) {
			if (
				state.board !== null ||
				state.isLocked ||
				state.previousBoard === null
			) {
				perdon();
				return;
			}

			state.isLocked = true;

			let board = state.previousBoard;
			let previousPosition = null;
			const logs = [];

			while (true) {
				{
					const transitions = getTransitions(board);

					const transitionResults = await sqlite.all(
						oneLine`
							SELECT board, result, depth
							FROM boards
							WHERE board IN (${Array(transitions.length)
		.fill('?')
		.join(', ')})
							ORDER BY RANDOM()
						`,
						transitions.map((transition) => serialize(transition.board))
					);

					const transitionResult = minBy(
						transitionResults.filter(({result}) => result === 0),
						'depth'
					);
					const transition = transitions.find(
						({board: b}) => Buffer.compare(serialize(b), transitionResult.board) === 0
					);
					board = deserialize(transitionResult.board);
					const logText = transitionToText(
						transition,
						Color.Black,
						previousPosition
					);
					logs.push(logText);

					previousPosition = {
						x: transition.data.to.x,
						y: transition.data.to.y,
					};

					// 先手詰み
					if (transitionResult.depth === 1) {
						break;
					}
				}

				{
					const transitions = getTransitions(board);

					const transitionResults = await sqlite.all(
						oneLine`
							SELECT board, result, depth
							FROM boards
							WHERE board IN (${Array(transitions.length)
		.fill('?')
		.join(', ')})
							ORDER BY RANDOM()
						`,
						transitions.map((transition) => serialize(transition.board))
					);

					const transitionResult = maxBy(
						transitionResults.filter(({result}) => result === 1),
						'depth'
					);
					const transition = transitions.find(
						({board: b}) => Buffer.compare(serialize(b), transitionResult.board) === 0
					);
					board = deserialize(transitionResult.board);

					const logText = transitionToText(
						transition,
						Color.White,
						previousPosition
					);
					logs.push(logText);

					previousPosition = {
						x: 4 - transition.data.to.x,
						y: 4 - transition.data.to.y,
					};
				}

				if (logs.length > 100) {
					break;
				}
			}

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: '正着手',
				username: 'shogi',
				icon_url: iconUrl,
				attachments: [
					{
						text: `正着手\n \n \n \n \n${logs.join(' ')} まで、${
							logs.length
						}手で先手の勝ち`,
					},
				],
			});

			state.isLocked = false;
			return;
		}

		if (
			message.thread_ts &&
			state.thread === message.thread_ts &&
			(match = text.match(
				/^(?<position>[123１２３一二三][123１２３一二三]|同)(?<pieceChar>歩|歩兵|香|香車|桂|桂馬|銀|銀将|金|金将|飛|飛車|角|角行|王|王将|玉|玉将|と|と金|成香|杏|成桂|圭|成銀|全|龍|竜|龍王|竜王|馬|龍馬|竜馬)(?:(?<xFlag>[右左直]?)(?<yFlag>[寄引上]?)(?<promoteFlag>成|不成)?|(?<dropFlag>打))?$/
			))
		) {
			const {
				position,
				pieceChar,
				xFlag,
				yFlag,
				promoteFlag,
				dropFlag,
			} = match.groups;
			const piece = charToPiece(pieceChar);

			if (
				state.board === null ||
				state.turn !== Color.Black ||
				state.isLocked
			) {
				perdon();
				return;
			}

			if (position === '同' && state.previousPosition === null) {
				perdon();
				return;
			}

			if (position === '同' && dropFlag === '打') {
				perdon('「同」と「打」は同時に指定できません。');
				return;
			}

			const x =
				position === '同'
					? state.previousPosition.x
					: ['1１一', '2２二', '3３三'].findIndex((chars) => chars.includes(position.charAt(0))) + 1;
			const y =
				position === '同'
					? state.previousPosition.y
					: ['1１一', '2２二', '3３三'].findIndex((chars) => chars.includes(position.charAt(1))) + 1;

			const newPosition =
				state.previousPosition &&
				state.previousPosition.x === x &&
				state.previousPosition.y === y
					? '同'
					: `${'123'[x - 1]}${'一二三'[y - 1]}`;

			if (dropFlag !== '打') {
				const moves = state.board.getMovesTo(x, y, piece, Color.Black);

				const yFilteredMoves = moves
					.filter((move) => {
						if (yFlag === '引') {
							return move.from.y < move.to.y;
						}

						if (yFlag === '上') {
							return move.from.y > move.to.y;
						}

						if (yFlag === '寄') {
							return move.from.y === move.to.y;
						}

						assert(!yFlag);
						return true;
					})
					.sort((a, b) => b.from.x - a.from.x);

				if (yFilteredMoves.length >= 1) {
					const filteredMoves = moves.filter((move, index) => {
						if (['HI', 'KA', 'RY', 'UM'].includes(piece)) {
							if (xFlag === '右') {
								return index === moves.length - 1;
							}

							if (xFlag === '左') {
								return index === 0;
							}
						}

						if (xFlag === '右') {
							return move.from.x < move.to.x;
						}

						if (xFlag === '左') {
							return move.from.x > move.to.x;
						}

						if (xFlag === '直') {
							return move.from.x === move.to.x;
						}

						assert(!xFlag);
						return true;
					});

					if (filteredMoves.length > 1) {
						perdon('`[右左直]?[寄引上]?` を指定してください。');
						return;
					} else if (filteredMoves.length === 1) {
						const move = filteredMoves[0];

						const isPromotable =
							(move.from.y === 1 || move.to.y === 1) && Piece.canPromote(piece);

						if (isPromotable && !promoteFlag) {
							perdon('成・不成を指定してください。');
							return;
						}

						state.board.move(
							move.from.x,
							move.from.y,
							move.to.x,
							move.to.y,
							isPromotable && promoteFlag === '成'
						);

						const didPromote =
							state.board.get(move.to.x, move.to.y).piece !== piece;

						state.turn = Color.White;
						state.isPrevious打ち歩 = false;
						state.previousPosition = {x, y};
						const newPromoteFlag = didPromote ? '成' : '不成';
						const logText = `☗${newPosition}${pieceToChar(piece)}${
							isPromotable ? newPromoteFlag : ''
						}`;
						state.log.push(logText);

						if (piece === 'GI' && isPromotable && promoteFlag === '不成') {
							state.flags.add('銀不成');
						}
						if (piece === 'FU' && isPromotable && promoteFlag === '成') {
							state.flags.add('歩成');
						}

						await post(logText);

						aiTurn();

						return;
					}
				}
			}

			const hands = state.board
				.getDropsBy(Color.Black)
				.filter(({to, kind}) => to.x === x && to.y === y && kind === piece);
			if (hands.length > 0) {
				state.board.drop(x, y, piece, Color.Black);

				state.turn = Color.White;
				state.isPrevious打ち歩 = piece === 'FU';
				state.previousPosition = {x, y};
				const logText = `☗${newPosition}${pieceToChar(piece)}`;
				state.log.push(logText);

				if (piece === 'HI' && y === 3) {
					state.flags.add('自陣飛車');
				}
				if (piece === 'KA' && y === 3) {
					state.flags.add('自陣角');
				}

				await post(logText);

				aiTurn();

				return;
			}

			perdon('条件を満たす駒がありません。');
			return;
		}

		if (
			message.thread_ts &&
			state.thread === message.thread_ts &&
			['負けました', '投げます', 'ありません', '投了'].includes(text)
		) {
			if (state.board === null || state.turn !== Color.Black) {
				perdon();
				return;
			}

			end(Color.White);
			return;
		}

		if (
			message.thread_ts &&
			state.thread === message.thread_ts &&
			text === '盤面'
		) {
			if (state.board === null || state.turn !== Color.Black) {
				perdon();
				return;
			}

			if (state.logs.length === 0) {
				await post('初手');
			} else {
				await post(`${last(state.logs)}まで`);
			}
		}
	});
};
