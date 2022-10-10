import { View } from '@slack/web-api';

export default (message: string) => ({
	type: "modal",
	title: {
		type: "plain_text",
		text: "エラー",
		emoji: true
	},
	"blocks": [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": message,
			}
		}
	]
} as View);
