import { View } from '@slack/web-api';
import { TaimaiGame } from '..';
import config from '../config';
import { formatOutlineUnfilled } from '../util';

export default (game: TaimaiGame, focus: number) => ({
	type: "modal",
	callback_id: 'taimai_fill_piece',
	title: {
		type: "plain_text",
		text: "タイマイの問題を埋める",
		emoji: true
	},
	submit: {
		type: "plain_text",
		text: "確定する",
		emoji: true
	},
	"blocks": [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `以下の文章の${config.placeholders[focus]}にあてはまる内容を入力してください。`
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": formatOutlineUnfilled(game.outline, game.pieces)
			}
		},
		{
			"type": "input",
			"element": {
				"type": "plain_text_input",
				"action_id": "taimai_fill_piece"
			},
			"label": {
				"type": "plain_text",
				"text": "空欄の内容",
				"emoji": true
			}
		},
		{
			"type": "context",
			"elements": [
				{
					"type": "plain_text",
					"text": `文章として成立するよう、前後と繋がるように注意してください。1文字以上${config.maxPieceChars}文字以下の制約があります。空欄が全て埋まると完成した文章が公開されます。`,
					"emoji": true
				}
			]
		}
	]
} as View);
