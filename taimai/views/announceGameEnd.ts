import { TaimaiGame } from '..';

export default (game: TaimaiGame) => ({
	text: `正解: ${game.answer}`,
	blocks: [
		{
			"type": "context",
			"elements": [
				{
					"type": "mrkdwn",
					"text": "セッション終了!"
				}
			]
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*正解:* ${game.answer}`
			}
		}
	]
});
