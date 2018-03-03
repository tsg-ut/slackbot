const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const {default: Color} = require('shogi9.js/lib/Color.js');
const {default: Piece} = require('shogi9.js/lib/Piece.js');
const sqlite = require('sqlite');
const path = require('path');

const {deserialize, getTransitions, charToPiece} = require('./Board.js');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		previousPosition: null,
		board: null,
	};

	let match = null;

	const perdon = () => {
		slack.chat.postMessage(process.env.CHANNEL_SANDBOX, ':ha:', {
			username: 'shogi',
			icon_url: 'https://2.bp.blogspot.com/-UT3sRYCqmLg/WerKjjCzRGI/AAAAAAABHpE/kenNldpvFDI6baHIW0XnB6JzITdh3hB2gCLcBGAs/s400/character_game_syougi.png',
		});
	};

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		const {text} = message;

		if (text.startsWith('将棋')) {
			await sqlite.open(path.resolve(__dirname, 'boards/4444.sqlite3'));
			const data = await sqlite.get('SELECT * FROM boards WHERE result = 1 AND depth = 6 AND is_good = 1 ORDER BY RANDOM() LIMIT 1');
			state.board = deserialize(data.board);

			await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, state.board.toSFENString(), {
				username: 'shogi',
				icon_url: 'https://2.bp.blogspot.com/-UT3sRYCqmLg/WerKjjCzRGI/AAAAAAABHpE/kenNldpvFDI6baHIW0XnB6JzITdh3hB2gCLcBGAs/s400/character_game_syougi.png',
			});
		}

		if ((match = text.match(/^([123１２３一二三][123１２３一二三]|同)(歩|香|桂|銀|金|飛|角|王|と|成香|成桂|成銀|龍|馬)([右左直]?)([寄引上]?)(成|不成|打)?$/))) {
			const [, position, pieceChar, xFlag, yFlag, promoteFlag] = match;
			const piece = charToPiece(pieceChar);

			if (state.board === null) {
				perdon();
				return;
			}

			if (position === '同' && state.previousPosition === null) {
				perdon();
				return;
			}

			const x = ['1１一', '2２二', '3３三'].findIndex((chars) => chars.includes(position.charAt(0))) + 1;
			const y = ['1１一', '2２二', '3３三'].findIndex((chars) => chars.includes(position.charAt(1))) + 1;

			const moves = state.board.getMovesTo(x, y, piece, Color.Black);
			if (moves.length > 0) {
				const move = moves[0];
				const isPromotable = (move.from.y === 1 || move.to.y === 1) && Piece.canPromote(piece);

				if (isPromotable && promoteFlag === undefined) {
					perdon();
					return;
				}

				state.board.move(move.from.x, move.from.y, move.to.x, move.to.y, isPromotable && promoteFlag === '成');

				await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, state.board.toSFENString(), {
					username: 'shogi',
					icon_url: 'https://2.bp.blogspot.com/-UT3sRYCqmLg/WerKjjCzRGI/AAAAAAABHpE/kenNldpvFDI6baHIW0XnB6JzITdh3hB2gCLcBGAs/s400/character_game_syougi.png',
				});
			} else {
				perdon();
			}
		}
	});
};
