import { TaimaiGame } from '..';
import config from '../config';
import { formatOutlineFilled } from '../util';

export default (game: TaimaiGame) => ({
	text: `タイマイの問題が終了: ${game.answer || '投了'}`,
	blocks: [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "終了済みのタイマイ"
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*問題*: ${formatOutlineFilled(game.outline, game.pieces)}\n*正解:* ${game.answer || 'なし'}\n*回答者:* ${game.answer ? `<@${game.answerAuthor}>` : 'なし'}`,
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
		}
	]
});
