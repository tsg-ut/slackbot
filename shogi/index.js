const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const sqlite = require('sqlite');
const path = require('path');

const Board = require('./Board.js');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		scrambles: [],
	};

	await sqlite.open(path.resolve(__dirname, 'boards/3366.sqlite3'));
	const d = await sqlite.get('SELECT * FROM boards WHERE depth = 8 ORDER BY RANDOM() LIMIT 1');
	const b = Board.fromBlob(d.board);
	console.log(b.getImage());

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		const {text} = message;

		if (text.startsWith('将棋')) {
			await sqlite.open(path.resolve(__dirname, 'boards/3366.sqlite3'));
			const data = await sqlite.get('SELECT * FROM boards WHERE result = 1 AND depth = 8 ORDER BY RANDOM() LIMIT 1');
			const board = Board.fromBlob(data.board);
			console.log(board.getImage());
		}
	});
};
