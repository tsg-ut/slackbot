import { TaimaiGame } from '..';
import config from '../config';
import { formatOutlineFilled } from '../util';

export default (game: TaimaiGame) => ({
	text: `タイマイの問題が進行中: ${formatOutlineFilled(game.outline, game.pieces)}`,
	blocks: [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "タイマイが進行中!"
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": formatOutlineFilled(game.outline, game.pieces),
			}
		},
		{
			"type": "context",
			"elements": [
				{
					"type": "mrkdwn",
					"text": `出題者: <@${game.outlineAuthor}>${
						[...Array(game.pieces.length).keys()]
							.filter(i => game.pieceAuthors[i])
							.map(i => `, ${config.placeholders[i]}: <@${game.pieceAuthors[i]}>`)
							.join('')
					}`
				}
			]
		},
		{
			"type": "context",
			"elements": [
				{
					"type": "plain_text",
					"text": "スレッドで回答してください。",
					"emoji": true
				}
			]
		}
	]
});
