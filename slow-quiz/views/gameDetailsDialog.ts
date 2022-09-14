import {View} from '@slack/web-api';
import {sortBy} from 'lodash';
import type {Game} from '../index';

export default (game: Game) => {
	const answerInfos = sortBy([
		...game.correctAnswers,
		...game.wrongAnswers ?? [],
	], (answer) => answer.date ?? 0);

	return {
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
					text: `<@${game.author}>`,
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
					text: '回答一覧',
					emoji: true,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: answerInfos.map((info) => (
						`${info.progress}日目: <@${info.user}> 「${info.answer}」`
					)).join('\n'),
				},
			},
		],
	} as View;
};
