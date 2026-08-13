import type {View} from '@slack/web-api';
import type {Game} from '../index.js';
import {getUserMention} from '../util.js';
import {getSubmissionsBlocks} from './lib/utils.js';

export default (game: Game): View => ({
	type: 'modal',
	callback_id: 'slowquiz_answer_question_dialog',
	title: {
		text: '問題詳細',
		type: 'plain_text',
	},
	blocks: [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '出題者',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: getUserMention(game.author),
			},
		},
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '問題',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: game.question,
			},
		},
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '答え',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: game.answer,
			},
		},
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '読み',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: game.ruby,
			},
		},
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: 'ヒント',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: game.hint ?? 'なし',
			},
		},
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: 'ログ',
				emoji: true,
			},
		},
		...getSubmissionsBlocks(game, null),
	],
});
