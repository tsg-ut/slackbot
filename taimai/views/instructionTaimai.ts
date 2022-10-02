import { View } from '@slack/web-api';
import { stripIndent } from 'common-tags';
import { TaimaiGame } from '..';
import config from '../config';
import { formatOutlineDynamic } from '../util';

export default (games: TaimaiGame[]) => ({
  blocks: [
		{
			"type": "header",
			"text": {
				"type": "plain_text",
				"text": "タイマイの遊び方",
				"emoji": true
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": stripIndent`
        タイマイは、<https://ja.wikipedia.org/wiki/%E3%82%B7%E3%83%81%E3%83%A5%E3%82%A8%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3%E3%83%91%E3%82%BA%E3%83%AB|ウミガメのスープ>にインスパイアされたゲームです:turtle:
        複数人で文章のかけらを持ち寄って謎の文章を作り、botに質問を繰り返すことでその文章の背景にある謎を明らかにしましょう。
        新しいタイマイセッションを開始するには、 \`タイマイ 男は[]にも関わらず[]した。一体なぜ?\` のように、0個以上${config.placeholders.length}個以下の空欄 \`[]\` が入っていて \`?\` で終わる疑問文をsandboxに投稿してください。
        それぞれの空欄を別々の人が埋めたらゲームの始まりです!`
			}
		},
		{
			"type": "divider"
		},
		{
			"type": "header",
			"text": {
				"type": "plain_text",
				"text": "現在開催中のタイマイ",
				"emoji": true
			}
		},
		...games.map(game => ({
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": formatOutlineDynamic(game.outline, game.pieces)
			},
			"accessory": {
				"type": "button",
				"text": {
					"type": "plain_text",
					"text": "スレッドに行く",
					"emoji": true
				},
				"value": "click_me_123",
				"url": game.permalink,
				"action_id": "button-action"
			}
		}))
	],
} as View);
