import {View} from '@slack/web-api';
import {sortBy} from 'lodash';
import type {Game, Submission} from '../index';

type UserSubmission = Submission & {type: 'wrong_answer' | 'correct_answer' | 'comment'}

const formatSubmission = ({progress, type, user, answer}: UserSubmission) => {
	if (type === 'wrong_answer') {
		return `${progress}日目: <@${user}> ＊回答「${answer}」＊ → 不正解`;
	}
	if (type === 'correct_answer') {
		return `${progress}日目: <@${user}> ＊回答「${answer}」＊ → 正解`;
	}
	return `${progress}日目: <@${user}> ${answer}`;
};

export default (game: Game) => {
	const submissions = sortBy([
		...game.wrongAnswers.map((answer) => ({...answer, type: 'wrong_answer'} as UserSubmission)),
		...game.correctAnswers.map((answer) => ({...answer, type: 'correct_answer'} as UserSubmission)),
		...game.comments.map((comment) => ({...comment, type: 'comment'} as UserSubmission)),
	], (submission) => submission.date ?? 0);

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
					text: 'ログ',
					emoji: true,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: submissions.map(formatSubmission).join('\n'),
				},
			},
		],
	} as View;
};
