import {View} from '@slack/web-api';
import {stripIndent} from 'common-tags';
import type {Game} from '../index';
import {getSubmissionsBlocks} from './lib/utils';

export default (game: Game, user: string): View => ({
	type: 'modal',
	callback_id: 'slowquiz_post_comment_dialog',
	title: {
		text: 'コメント送信',
		type: 'plain_text',
	},
	submit: {
		text: '投稿する',
		type: 'plain_text',
	},
	notify_on_close: true,
	private_metadata: game.id,
	blocks: [
		{
			type: 'context',
			elements: [
				{
					type: 'plain_text',
					text: stripIndent`
							この問題には解答済みです。
							任意で問題に対するコメントを投稿することができます。
						`,
				},
			],
		},
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: 'あなたのこれまでのコメント',
				emoji: true,
			},
		},
		...getSubmissionsBlocks(game, user),
		{
			type: 'input',
			dispatch_action: true,
			label: {
				type: 'plain_text',
				text: 'コメント',
				emoji: true,
			},
			element: {
				type: 'plain_text_input',
				action_id: 'slowquiz_post_comment_submit_comment',
				dispatch_action_config: {
					trigger_actions_on: ['on_enter_pressed'],
				},
			},
			hint: {
				type: 'plain_text',
				text: 'クイズ終了まで公開されません',
			},
		},
	],
});
