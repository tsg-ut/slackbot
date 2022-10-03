import { TaimaiGame } from '..';
import { formatOutlineFilled } from '../util';

export default (game: TaimaiGame) => ({
	text: `問題: ${formatOutlineFilled(game.outline, game.pieces)}`,
	blocks: [
		{
			"type": "context",
			"elements": [
				{
					"type": "mrkdwn",
					"text": "セッション開始!"
				}
			]
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*問題:* ${formatOutlineFilled(game.outline, game.pieces)}`
			}
		},
		{
			"type": "context",
			"elements": [
				{
					"type": "mrkdwn",
					"text": "スレッドでゲームを進行します。"
				}
			]
		}
	]
});
