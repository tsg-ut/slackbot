const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const {default: Shogi} = require('shogi9.js');
const {default: Color} = require('shogi9.js/lib/Color.js');
const {default: Piece} = require('shogi9.js/lib/Piece.js');
const sqlite = require('sqlite');
const path = require('path');
const fs = require('fs');
const {promisify} = require('util');
const minBy = require('lodash/minBy');
const maxBy = require('lodash/maxBy');
const sample = require('lodash/sample');

const {
	serialize,
	deserialize,
	getTransitions,
	charToPiece,
	transitionToText,
} = require('./util.js');
const {upload} = require('./image.js');

const iconUrl = 'https://2.bp.blogspot.com/-UT3sRYCqmLg/WerKjjCzRGI/AAAAAAABHpE/kenNldpvFDI6baHIW0XnB6JzITdh3hB2gCLcBGAs/s400/character_game_syougi.png';

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		previousPosition: null,
		previousBoard: new Shogi({
			preset: 'OTHER',
			data: {
				color: Color.Black,
				board: [
					[{color: Color.Black, kind: 'OU'}, {}, {}],
					[{}, {}, {color: Color.Black, kind: 'KY'}],
					[{color: Color.White, kind: 'OU'}, {}, {}],
				],
				hands: [
					{HI: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, FU: 0},
					{HI: 0, KY: 0, KE: 1, GI: 0, KI: 1, KA: 0, FU: 0},
				],
			},
		}),
		previousDatabase: '00.sqlite3',
		isPrevious打ち歩: false,
		isLocked: false,
		player: null,
		board: null,
		turn: null,
		log: [],
	};

	let match = null;

	const perdon = () => {
		slack.chat.postMessage(process.env.CHANNEL_SANDBOX, ':ha:', {
			username: 'shogi',
			icon_url: iconUrl,
		});
	};

	const post = async (message) => {
		const imageUrl = await upload(state.board);
		await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, message, {
			username: 'shogi',
			icon_url: iconUrl,
			attachments: [
				{
					image_url: imageUrl,
					fallback: state.board.toSFENString(),
				},
			],
		});
	};

	const end = async (color, reason) => {
		const {log} = state;
		state.previousPosition = null;
		state.board = null;
		state.turn = null;
		state.log = [];

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const player = color === Color.Black ? `先手<@${state.player}>` : '後手9マスしょうぎ名人';
		const message = `まで、${log.length}手で${player}の勝ちです。${reason ? `(${reason})` : ''}`;

		await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, message, {
			username: 'shogi',
			icon_url: iconUrl,
		});
	};

	const aiTurn = async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const inversedBoard = state.board.inverse();

		const currentResult = await sqlite.get(
			'SELECT board, result, depth FROM boards WHERE board = ?',
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
			`SELECT board, result, depth FROM boards WHERE board IN (${Array(
				transitions.length
			)
				.fill('?')
				.join(', ')})`,
			transitions.map((transition) => serialize(transition.board))
		);

		const loseResults = transitionResults.filter(({result}) => result === 0);
		const winResults = transitionResults.filter(({result}) => result === 1);
		const unknownResults = transitionResults.filter(({result}) => result === null);
		state.isPrevious打ち歩 = false;

		if (loseResults.length > 0) {
			const transition = minBy(loseResults, 'depth');
			state.board = deserialize(transition.board);
			state.turn = Color.Black;
			const logText = transitionToText(transitions.find(({board}) => Buffer.compare(serialize(board), transition.board) === 0), Color.White);
			state.log.push(logText);
			await post(logText);

			// 先手詰み
			if (transition.depth === 1) {
				end(Color.White);
			}
		} else {
			const transition = unknownResults.length > 0 ? sample(unknownResults) : maxBy(winResults, 'depth');
			state.board = deserialize(transition.board);
			state.turn = Color.Black;
			const logText = transitionToText(transitions.find(({board}) => Buffer.compare(serialize(board), transition.board) === 0), Color.White);
			state.log.push(logText);
			await post(logText);
		}
	};

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		const {text} = message;

		if (text === '将棋') {
			if (state.board !== null || state.isLocked) {
				perdon();
				return;
			}

			const databases = await promisify(fs.readdir)(path.resolve(__dirname, 'boards'));
			state.previousDatabase = sample(databases);
			await sqlite.open(path.resolve(__dirname, 'boards', state.previousDatabase));
			const data = await sqlite.get(
				'SELECT * FROM boards WHERE result = 1 AND depth > 5 AND is_good = 1 ORDER BY RANDOM() LIMIT 1'
			);
			state.board = deserialize(data.board);
			state.previousBoard = state.board.clone();
			state.isPrevious打ち歩 = false;
			state.turn = Color.Black;
			state.player = message.user;

			await post(`${data.depth - 1}手必勝`);
			return;
		}

		if (text === 'もう一回') {
			if (state.previousBoard === null || state.board !== null || state.isLocked) {
				perdon();
				return;
			}

			await sqlite.open(path.resolve(__dirname, 'boards', state.previousDatabase));
			state.board = state.previousBoard;
			state.previousBoard = state.board.clone();
			state.isPrevious打ち歩 = false;
			state.turn = Color.Black;
			state.player = message.user;

			await post('もう一回');
			return;
		}

		if (text === '正着手') {
			if (state.board !== null || state.isLocked || state.previousBoard === null) {
				perdon();
				return;
			}

			state.isLocked = true;

			let board = state.previousBoard;
			const logs = [];

			while (true) {
				{
					const transitions = getTransitions(board);

					const transitionResults = await sqlite.all(
						`SELECT board, result, depth FROM boards WHERE board IN (${Array(
							transitions.length
						)
							.fill('?')
							.join(', ')})`,
						transitions.map((transition) => serialize(transition.board))
					);

					const transition = minBy(transitionResults.filter(({result}) => result === 0), 'depth');
					board = deserialize(transition.board);
					const logText = transitionToText(transitions.find(({board}) => Buffer.compare(serialize(board), transition.board) === 0), Color.Black);
					logs.push(logText);

					// 先手詰み
					if (transition.depth === 1) {
						break;
					}
				}

				{
					const transitions = getTransitions(board);

					const transitionResults = await sqlite.all(
						`SELECT board, result, depth FROM boards WHERE board IN (${Array(
							transitions.length
						)
							.fill('?')
							.join(', ')})`,
						transitions.map((transition) => serialize(transition.board))
					);

					const transition = maxBy(transitionResults.filter(({result}) => result === 1), 'depth');
					board = deserialize(transition.board);
					const logText = transitionToText(transitions.find(({board}) => Buffer.compare(serialize(board), transition.board) === 0), Color.White);
					logs.push(logText);
				}

				if (logs.length > 100) {
					break;
				}
			}

			await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `${logs.join(' ')} まで、${logs.length}手で先手の勝ちです。`, {
				username: 'shogi',
				icon_url: iconUrl,
			});

			state.isLocked = false;
			return;
		}

		if (
			(match = text.match(
				/^([123１２３一二三][123１２３一二三])(歩|香|桂|銀|金|飛|角|王|玉|と|成香|成桂|成銀|龍|馬)([右左直]?)([寄引上]?)(成|不成|打)?$/
			))
		) {
			const [, position, pieceChar, xFlag, yFlag, promoteFlag] = match;
			const piece = charToPiece(pieceChar);

			if (state.board === null || state.turn !== Color.Black || state.isLocked) {
				perdon();
				return;
			}

			if (position === '同' && state.previousPosition === null) {
				perdon();
				return;
			}

			const x =
				['1１一', '2２二', '3３三'].findIndex((chars) =>
					chars.includes(position.charAt(0))) + 1;
			const y =
				['1１一', '2２二', '3３三'].findIndex((chars) =>
					chars.includes(position.charAt(1))) + 1;

			if (promoteFlag !== '打') {
				const moves = state.board.getMovesTo(x, y, piece, Color.Black);
				if (moves.length > 0) {
					const move = moves[0];
					const isPromotable =
						(move.from.y === 1 || move.to.y === 1) && Piece.canPromote(piece);

					if (isPromotable && promoteFlag === undefined) {
						perdon();
						return;
					}

					state.board.move(
						move.from.x,
						move.from.y,
						move.to.x,
						move.to.y,
						isPromotable && promoteFlag === '成'
					);

					state.turn = Color.White;
					state.isPrevious打ち歩 = false;
					const logText = `☗${'123'[x - 1]}${'一二三'[y - 1]}${pieceChar}`;
					state.log.push(logText);

					await post(logText);

					aiTurn();

					return;
				}
			}

			const hands = state.board
				.getDropsBy(Color.Black)
				.filter(({to, kind}) => to.x === x && to.y === y && kind === piece);
			if (hands.length > 0) {
				state.board.drop(x, y, piece, Color.Black);

				state.turn = Color.White;
				state.isPrevious打ち歩 = piece === 'FU';
				const logText = `☗${'123'[x - 1]}${'一二三'[y - 1]}${pieceChar}`;
				state.log.push(logText);

				await post(logText);

				aiTurn();

				return;
			}

			perdon();
			return;
		}

		if (text === '負けました') {
			if (state.board === null || state.turn !== Color.Black) {
				perdon();
				return;
			}

			end(Color.White);
		}
	});
};
