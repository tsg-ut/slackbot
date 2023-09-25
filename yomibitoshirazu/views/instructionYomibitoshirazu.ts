import { stripIndent } from "common-tags";

export default () => ({
	text: "詠み人知らずの遊び方",
	"blocks": [
		{
			"type": "header",
			"text": {
				"type": "plain_text",
				"text": "詠み人知らずの遊び方",
				"emoji": true
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": stripIndent`
        詠み人知らずは、複数人で１文字ずつ俳句を完成させていくゲームです:pencil:
        ゲームを開始したい人は、 \`詠み人知らず 募集\` とsandboxチャンネルに投稿して、参加者を募集してください。
        開始されたゲームに参加するには、 \`詠み人知らず 参加\` とsandboxチャンネルに投稿してください。
        人数が集まったら、 \`詠み人知らず 開始\` とsandboxチャンネルに投稿してください。`
			}
		},
        {
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "詠み人知らず　参加用ボタン"
			},
			"accessory": {
				"type": "button",
				"text": {
					"type": "plain_text",
					"text": "参加",
					"emoji": true
				},
				"value": "click_me_123",
				"action_id": "button-action"
			}
		}
	]
});