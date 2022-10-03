import { TaimaiGame } from '..';
import config from '../config';
import { formatOutlineUnfilled } from '../util';

export default (game: TaimaiGame) => ({
	text: `タイマイの新しい問題: ${formatOutlineUnfilled(game.outline, game.pieces)}`,
	blocks: [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": "タイマイの新しい問題が作成されたよ！"
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": formatOutlineUnfilled(game.outline, game.pieces),
			}
		},
		{
			"type": "actions",
			"elements": [...Array(game.pieces.length).keys()].filter(i => game.pieces[i] === undefined).map(i => ({
				"type": "button",
				"text": {
					"type": "plain_text",
					"text": `空欄${config.placeholders[i]}を埋める`,
					"emoji": true
				},
				"value": "click_me_123",
				"action_id": `taimai_show_fill_modal_${i}`
			})),
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
		},
		{
			"type": "context",
			"elements": [
				{
					"type": "plain_text",
					"text": "空欄は出題者以外が1人1つだけ埋めることができます。空欄が全て埋まると完成した文章が公開されます。",
					"emoji": true
				}
			]
		}
	]
});
