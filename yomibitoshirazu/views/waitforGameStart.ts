import { stripIndent } from "common-tags";

export default (message: any) => ({
	text: "ゲームの開始待ち",
	"blocks": [
		{
			"type": "header",
			"text": {
				"type": "plain_text",
				"text": `開始待ち`,
				"emoji": true
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": stripIndent`
        ゲームの開始を待っています。
        参加者が集まったら， \`詠み人知らず 開始\`とsandboxチャンネルに投稿してください。
                `
			}
		},
	]
});