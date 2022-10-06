import 'dotenv/config';
import State from "../lib/state";
import {Game} from "../slow-quiz";

interface StateObj {
	games: Game[],
	latestStatusMessages: {ts: string, channel: string}[],
}

(async () => {
	console.log('init');
	const state = await State.init<StateObj>('slow-quiz', {
		games: [],
		latestStatusMessages: [],
	});

	for (const game of state.games) {
		if (typeof game.days !== 'number') {
			game.days = game.progress;
		}

		if (!Array.isArray(game.correctAnswers)) {
			game.correctAnswers = [];
		}
		for (const answer of game.correctAnswers) {
			if (typeof answer.days !== 'number') {
				answer.days = answer.progress;
			}
		}

		if (!Array.isArray(game.wrongAnswers)) {
			game.wrongAnswers = [];
		}
		for (const answer of game.wrongAnswers) {
			if (typeof answer.days !== 'number') {
				answer.days = answer.progress;
			}
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}
		for (const answer of game.comments) {
			if (typeof answer.days !== 'number') {
				answer.days = answer.progress;
			}
		}

		if (typeof game.genre !== 'string') {
			if (game.author === 'U04G7TL4P') {
				game.genre = 'normal';
			} else {
				game.genre = 'anything';
			}
		}

		console.log(`Migrated ${game.id}`);
		console.log(game);
	}
})();