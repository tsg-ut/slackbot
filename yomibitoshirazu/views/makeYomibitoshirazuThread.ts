import { stripIndent } from "common-tags";

export default (message: any) => ({
	text: "詠み人知らずプレイ用スレッド",
	"blocks": [
		{
			"type": "header",
			"text": {
				"type": "plain_text",
				"text": "詠み人知らずプレイ用スレッド",
				"emoji": true
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": stripIndent`
        以下のスレッドは、<@${message.user}>さんだけが見るようにしてください。
                `
			}
		},
	]
});