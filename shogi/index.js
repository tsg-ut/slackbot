const path = require('path');
const {default: Shogi} = require('shogi9.js');
const {default: Color} = require('shogi9.js/lib/Color.js');
const {default: Piece} = require('shogi9.js/lib/Piece.js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs').promises;
const assert = require('assert');
const minBy = require('lodash/minBy');
const maxBy = require('lodash/maxBy');
const sample = require('lodash/sample');
const last = require('lodash/last');
const flatten = require('lodash/flatten');
const oneLine = require('common-tags/lib/oneLine');
const {unlock, increment} = require('../achievements');
const {ChannelLimitedBot} = require('../lib/channelLimitedBot.ts');
const {extractMessage, isGenericMessage} = require('../lib/slackUtils.ts');

const {upload} = require('./image.js');
const {
	serialize,
	deserialize,
	getTransitions,
	charToPiece,
	pieceToChar,
	transitionToText,
} = require('./util.js');

const iconUrl =
	'https://2.bp.blogspot.com/-UT3sRYCqmLg/WerKjjCzRGI/AAAAAAABHpE/kenNldpvFDI6baHIW0XnB6JzITdh3hB2gCLcBGAs/s400/character_game_syougi.png';

class ShogiBot extends ChannelLimitedBot {
	constructor(slackClients) {
		super(slackClients);

		this.state = {
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
			isSpoiled: false,
			isLocked: false,
			isEnded: false,
			player: null,
			board: null,
			turn: null,
			log: [],
			thread: null,
			channel: null,
			gameMessageTs: null,
			flags: new Set(),
			db: null,
		};

		this.username = 'shogi';
		this.wakeWordRegex = /^(?:将棋|\d+手(?:詰め|必勝将棋)|\d+手以上(?:詰め|必勝将棋))$/;
	}

	postMessage(message) {
		return this.slack.chat.postMessage({
			username: 'shogi',
			icon_url: iconUrl,
			...message,
		});
	}

	async perdon(description = '', broadcast = false) {
		await this.postMessage({
			channel: this.state.channel,
			text: ':ha:',
			thread_ts: this.state.thread,
			reply_broadcast: broadcast,
		});
		if (description !== '') {
			await this.postMessage({
				channel: this.state.channel,
				text: `${description}:korosuzo:`,
				thread_ts: this.state.thread,
				reply_broadcast: broadcast,
			});
		}
	}

	async post(message, {mode = 'thread'} = {}) {
		const imageUrl = await upload(this.state.board);
		return this.postMessage({
			channel: this.state.channel,
			text: message,
			attachments: [
				{
					image_url: imageUrl,
					fallback: this.state.board.toSFENString(),
				},
			],
			thread_ts: this.state.thread,
			...(mode === 'broadcast' ? {reply_broadcast: true} : {}),
		});
	}

	async end(color, reason) {
		const {log, isEnded} = this.state;
		this.state.previousPosition = null;
		this.state.board = null;
		this.state.turn = null;
		this.state.log = [];
		this.state.isEnded = true;

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const player =
			color === Color.Black
				? `先手<@${this.state.player}>`
				: '後手9マスしょうぎ名人';
		const message = `まで、${log.length}手で${player}の勝ちです。${
			reason ? `(${reason})` : ''
		}`;

		await this.postMessage({
			channel: this.state.channel,
			text: message,
			thread_ts: this.state.thread,
			reply_broadcast: true,
		});

		if (log.length === this.state.previousTurns) {
			await this.postMessage({
				channel: this.state.channel,
				text: '最短勝利:tada:',
				thread_ts: this.state.thread,
				reply_broadcast: true,
			});
		}

		if (this.state.gameMessageTs !== null) {
			await this.deleteProgressMessage(this.state.gameMessageTs);
		}

		if (reason === '打ち歩詰め') {
			await unlock(this.state.player, 'shogi-打ち歩詰め');
		}
		if (color === Color.Black) {
			await unlock(this.state.player, 'shogi');
			if (log.length === this.state.previousTurns) {
				await unlock(this.state.player, 'shogi-shortest');
				if (!this.state.isSpoiled && this.state.previousTurns >= 7) {
					await increment(this.state.player, 'shogiWin');
				}
				if (this.state.previousTurns >= 11) {
					await unlock(this.state.player, 'shogi-over11');
				}
				if (this.state.previousTurns >= 19) {
					await unlock(this.state.player, 'shogi-over19');
					if (!isEnded) {
						await unlock(this.state.player, 'shogi-over19-without-end');
					}
				}
				if (this.state.previousTurns >= 7) {
					if (!isEnded) {
						await unlock(this.state.player, 'shogi-shortest-without-end');
					}
					if (this.state.flags.has('銀不成')) {
						await unlock(this.state.player, 'shogi-銀不成');
					}
					if (this.state.flags.has('自陣飛車')) {
						await unlock(this.state.player, 'shogi-自陣飛車');
					}
					if (this.state.flags.has('自陣角')) {
						await unlock(this.state.player, 'shogi-自陣角');
					}
					if (this.state.flags.has('歩成')) {
						await unlock(this.state.player, 'shogi-歩成');
					}
					if (this.state.flags.has('三桂')) {
						await unlock(this.state.player, 'shogi-三桂');
					}
				}
			}
		}
	}

	async aiTurn() {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const inversedBoard = this.state.board.inverse();

		const currentResult = await this.state.db.get(
			oneLine`
				SELECT board, result, depth
				FROM boards
				WHERE board = ?
			`,
			serialize(inversedBoard),
		);

		// 先手自殺手
		if (!currentResult) {
			this.end(Color.White, '王手放置');
			return;
		}

		// 後手詰み
		if (currentResult.depth === 1) {
			if (this.state.isPrevious打ち歩) {
				this.end(Color.White, '打ち歩詰め');
				return;
			}

			this.end(Color.Black);
			return;
		}

		const transitions = getTransitions(inversedBoard);

		const transitionResults = await this.state.db.all(
			oneLine`
				SELECT board, result, depth
				FROM boards
				WHERE board IN (${Array(transitions.length)
		.fill('?')
		.join(', ')})
				ORDER BY RANDOM()
			`,
			transitions.map((transition) => serialize(transition.board)),
		);

		const loseResults = transitionResults.filter(({result}) => result === 0);
		const winResults = transitionResults.filter(({result}) => result === 1);
		const unknownResults = transitionResults.filter(
			({result}) => result === null,
		);
		this.state.isPrevious打ち歩 = false;

		if (loseResults.length > 0) {
			const transitionResult = minBy(loseResults, 'depth');
			const transition = transitions.find(
				({board}) => Buffer.compare(serialize(board), transitionResult.board) === 0,
			);
			this.state.board = deserialize(transitionResult.board);
			this.state.turn = Color.Black;
			const logText = transitionToText(
				transition,
				Color.White,
				this.state.previousPosition,
			);
			this.state.previousPosition = {
				x: 4 - transition.data.to.x,
				y: 4 - transition.data.to.y,
			};
			this.state.log.push(logText);
			await this.post(logText);

			// 先手詰み
			if (transitionResult.depth === 1) {
				this.end(Color.White);
			}
		} else {
			const transitionResult =
				unknownResults.length > 0
					? sample(unknownResults)
					: maxBy(winResults, 'depth');
			const transition = transitions.find(
				({board}) => Buffer.compare(serialize(board), transitionResult.board) === 0,
			);
			this.state.board = deserialize(transitionResult.board);
			this.state.turn = Color.Black;
			const logText = transitionToText(
				transition,
				Color.White,
				this.state.previousPosition,
			);
			this.state.previousPosition = {
				x: 4 - transition.data.to.x,
				y: 4 - transition.data.to.y,
			};
			this.state.log.push(logText);
			await this.post(logText);
		}
	}

	async onWakeWord(message, channel) {
		const {text, ts} = message;

		if (this.state.board !== null || this.state.isLocked) {
			await this.postMessage({
				channel: this.state.channel || channel,
				text: ':ha:',
				thread_ts: this.state.thread,
				reply_broadcast: true,
			});
			return null;
		}

		if (message.thread_ts) {
			await this.postMessage({
				channel: this.state.channel || channel,
				text: ':ha:',
				thread_ts: this.state.thread,
			});
			await this.postMessage({
				channel: this.state.channel || channel,
				text: 'スレッド中からの起動はやめてください:korosuzo:',
				thread_ts: this.state.thread,
			});
			return null;
		}

		let matches = null;
		let condition = '';
		if ((matches = text.match(/^(?<count>\d+)手(?:詰め|必勝将棋)$/))) {
			condition = `depth = ${(parseInt(
				matches.groups.count.replace(/^0+/, ''),
			) || 0) + 1}`;
		} else if (
			(matches = text.match(/^(?<count>\d+)手以上(?:詰め|必勝将棋)$/))
		) {
			condition = `depth > ${parseInt(
				matches.groups.count.replace(/^0+/, ''),
			) || 0}`;
		} else {
			condition = 'depth > 5';
		}

		const databases = await fs.readdir(path.resolve(__dirname, 'boards'));
		const database = sample(databases);
		this.state.db = await sqlite.open({
			filename: path.join(__dirname, 'boards', database),
			driver: sqlite3.Database,
		});
		const data = await this.state.db.get(oneLine`
			SELECT *
			FROM boards
			WHERE result = 1 AND ${condition}
			ORDER BY is_good DESC, RANDOM()
			LIMIT 1
		`);
		if (data === undefined) {
			await this.postMessage({
				channel,
				text: ':thinking_face:',
			});
			return null;
		}

		this.state.previousDatabase = database;
		this.state.board = deserialize(data.board);
		this.state.previousBoard = this.state.board.clone();
		this.state.previousTurns = data.depth - 1;
		this.state.isPrevious打ち歩 = false;
		this.state.isSpoiled = false;
		this.state.isEnded = false;
		this.state.turn = Color.Black;
		this.state.player = message.user;
		this.state.flags = new Set();
		this.state.thread = ts;
		this.state.channel = channel;

		const 桂馬count = flatten([
			...this.state.board.board,
			this.state.board.hands[0],
		]).filter((piece) => piece && piece.color === Color.Black && piece.kind === 'KE').length;
		if (桂馬count >= 3) {
			this.state.flags.add('三桂');
		}

		const result = await this.post(`${data.depth - 1}手必勝`, {mode: 'broadcast'});
		this.state.gameMessageTs = result.ts;
		return result.ts;
	}

	async onMessageEvent(event) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);

		if (
			message === null ||
			!message.text ||
			message.bot_id !== undefined ||
			!isGenericMessage(message)
		) {
			return;
		}

		if (!this.allowedChannels.includes(message.channel)) {
			return;
		}

		const {text} = message;
		let match;

		if (
			message.thread_ts &&
			this.state.thread === message.thread_ts &&
			text === 'もう一回'
		) {
			if (this.state.previousBoard === null || this.state.isLocked) {
				await this.perdon();
				return;
			}

			if (this.state.board !== null) {
				await this.end(Color.White);
			}

			this.state.db = await sqlite.open({
				filename: path.resolve(__dirname, 'boards', this.state.previousDatabase),
				driver: sqlite3.Database,
			});
			this.state.board = this.state.previousBoard;
			this.state.previousBoard = this.state.board.clone();
			this.state.isPrevious打ち歩 = false;
			this.state.turn = Color.Black;
			this.state.player = message.user;
			this.state.flags = new Set();

			const 桂馬count = flatten([
				...this.state.board.board,
				this.state.board.hands[0],
			]).filter((piece) => piece && piece.color === Color.Black && piece.kind === 'KE').length;
			if (桂馬count >= 3) {
				this.state.flags.add('三桂');
			}

			const result = await this.post(`もう一回 (${this.state.previousTurns}手必勝)`);
			this.state.gameMessageTs = result.ts;
			return;
		}

		if (
			message.thread_ts &&
			this.state.thread === message.thread_ts &&
			text === '正着手'
		) {
			if (
				this.state.board !== null ||
				this.state.isLocked ||
				this.state.previousBoard === null
			) {
				await this.perdon();
				return;
			}

			this.state.isLocked = true;
			this.state.isSpoiled = true;

			let board = this.state.previousBoard;
			let previousPosition = null;
			const logs = [];

			while (true) {
				{
					const transitions = getTransitions(board);

					const transitionResults = await this.state.db.all(
						oneLine`
							SELECT board, result, depth
							FROM boards
							WHERE board IN (${Array(transitions.length)
		.fill('?')
		.join(', ')})
							ORDER BY RANDOM()
						`,
						transitions.map((transition) => serialize(transition.board)),
					);

					const transitionResult = minBy(
						transitionResults.filter(({result}) => result === 0),
						'depth',
					);
					const transition = transitions.find(
						({board: b}) => Buffer.compare(serialize(b), transitionResult.board) === 0,
					);
					board = deserialize(transitionResult.board);
					const logText = transitionToText(
						transition,
						Color.Black,
						previousPosition,
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

					const transitionResults = await this.state.db.all(
						oneLine`
							SELECT board, result, depth
							FROM boards
							WHERE board IN (${Array(transitions.length)
		.fill('?')
		.join(', ')})
							ORDER BY RANDOM()
						`,
						transitions.map((transition) => serialize(transition.board)),
					);

					const transitionResult = maxBy(
						transitionResults.filter(({result}) => result === 1),
						'depth',
					);
					const transition = transitions.find(
						({board: b}) => Buffer.compare(serialize(b), transitionResult.board) === 0,
					);
					board = deserialize(transitionResult.board);

					const logText = transitionToText(
						transition,
						Color.White,
						previousPosition,
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

			await this.postMessage({
				channel: this.state.channel,
				text: '正着手',
				attachments: [
					{
						text: `正着手\n \n \n \n \n${logs.join(' ')} まで、${
							logs.length
						}手で先手の勝ち`,
					},
				],
			});

			this.state.isLocked = false;
			return;
		}

		if (
			message.thread_ts &&
			this.state.thread === message.thread_ts &&
			(match = text.match(
				/^(?<position>[123１２３一二三][123１２３一二三]|同)(?<pieceChar>歩|歩兵|香|香車|桂|桂馬|銀|銀将|金|金将|飛|飛車|角|角行|王|王将|玉|玉将|と|と金|成香|杏|成桂|圭|成銀|全|龍|竜|龍王|竜王|馬|龍馬|竜馬)(?:(?<xFlag>[右左直]?)(?<yFlag>[寄引上]?)(?<promoteFlag>成|不成)?|(?<dropFlag>打))?$/,
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
				this.state.board === null ||
				this.state.turn !== Color.Black ||
				this.state.isLocked
			) {
				await this.perdon();
				return;
			}

			if (position === '同' && this.state.previousPosition === null) {
				await this.perdon();
				return;
			}

			if (position === '同' && dropFlag === '打') {
				await this.perdon('「同」と「打」は同時に指定できません。');
				return;
			}

			const x =
				position === '同'
					? this.state.previousPosition.x
					: ['1１一', '2２二', '3３三'].findIndex((chars) => chars.includes(position.charAt(0))) + 1;
			const y =
				position === '同'
					? this.state.previousPosition.y
					: ['1１一', '2２二', '3３三'].findIndex((chars) => chars.includes(position.charAt(1))) + 1;

			const newPosition =
				this.state.previousPosition &&
				this.state.previousPosition.x === x &&
				this.state.previousPosition.y === y
					? '同'
					: `${'123'[x - 1]}${'一二三'[y - 1]}`;

			if (dropFlag !== '打') {
				const moves = this.state.board.getMovesTo(x, y, piece, Color.Black);

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
					const filteredMoves = yFilteredMoves.filter((move, index) => {
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
						await this.perdon('`[右左直]?[寄引上]?` を指定してください。');
						return;
					} else if (filteredMoves.length === 1) {
						const move = filteredMoves[0];

						const isPromotable =
							(move.from.y === 1 || move.to.y === 1) && Piece.canPromote(piece);

						if (isPromotable && !promoteFlag) {
							await this.perdon('成・不成を指定してください。');
							return;
						}

						this.state.board.move(
							move.from.x,
							move.from.y,
							move.to.x,
							move.to.y,
							isPromotable && promoteFlag === '成',
						);

						const didPromote =
							this.state.board.get(move.to.x, move.to.y).piece !== piece;

						this.state.turn = Color.White;
						this.state.isPrevious打ち歩 = false;
						this.state.previousPosition = {x, y};
						const newPromoteFlag = didPromote ? '成' : '不成';
						const logText = `☗${newPosition}${pieceToChar(piece)}${
							isPromotable ? newPromoteFlag : ''
						}`;
						this.state.log.push(logText);

						if (piece === 'GI' && isPromotable && promoteFlag === '不成') {
							this.state.flags.add('銀不成');
						}
						if (piece === 'FU' && isPromotable && promoteFlag === '成') {
							this.state.flags.add('歩成');
						}

						await this.post(logText);

						this.aiTurn();

						return;
					}
				}
			}

			const hands = this.state.board
				.getDropsBy(Color.Black)
				.filter(({to, kind}) => to.x === x && to.y === y && kind === piece);
			if (hands.length > 0) {
				this.state.board.drop(x, y, piece, Color.Black);

				this.state.turn = Color.White;
				this.state.isPrevious打ち歩 = piece === 'FU';
				this.state.previousPosition = {x, y};
				const logText = `☗${newPosition}${pieceToChar(piece)}`;
				this.state.log.push(logText);

				if (piece === 'HI' && y === 3) {
					this.state.flags.add('自陣飛車');
				}
				if (piece === 'KA' && y === 3) {
					this.state.flags.add('自陣角');
				}

				await this.post(logText);

				this.aiTurn();

				return;
			}

			await this.perdon('条件を満たす駒がありません。');
			return;
		}

		if (
			message.thread_ts &&
			this.state.thread === message.thread_ts &&
			['負けました', '投げます', 'ありません', '投了'].includes(text)
		) {
			if (this.state.board === null || this.state.turn !== Color.Black) {
				await this.perdon();
				return;
			}

			this.end(Color.White);
			return;
		}

		if (
			message.thread_ts &&
			this.state.thread === message.thread_ts &&
			text === '盤面'
		) {
			if (this.state.board === null || this.state.turn !== Color.Black) {
				await this.perdon();
				return;
			}

			if (this.state.logs.length === 0) {
				await this.post('初手');
			} else {
				await this.post(`${last(this.state.logs)}まで`);
			}
		}
	}
}

module.exports = (slackClients) => new ShogiBot(slackClients);
