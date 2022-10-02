import { View } from '@slack/web-api';
import { TaimaiGame } from '..';

export default (game: TaimaiGame) => ({
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
} as View);
