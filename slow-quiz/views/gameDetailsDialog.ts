import {View} from '@slack/web-api';
import type {KnownBlock} from '@slack/web-api';
import {sortBy} from 'lodash';
import type {Game, Submission} from '../index';

type UserSubmission = Submission & { type: 'wrong_answer' | 'correct_answer' | 'comment' }

const formatSubmission = ({days, type, user, answer}: UserSubmission) => {
	if (type === 'wrong_answer') {
		return `${days}日目: <@${user}> ＊解答「${answer}」＊ → 不正解`;
	}
	if (type === 'correct_answer') {
		return `${days}日目: <@${user}> ＊解答「${answer}」＊ → 正解`;
	}
	return `${days}日目: <@${user}> ${answer}`;
};

const getSubmissionsBlocks = (submissions: UserSubmission[]) => {
	const blocks: KnownBlock[] = [];
	let text = '';
	for (const submission of submissions) {
		if (Array.from(text).length >= 2000) {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text,
				},
			});
			text = '';
		}
		text += formatSubmission(submission);
		text += '\n';
	}

	if (text !== '') {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text,
			},
		});
	}

	return blocks;
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
			...getSubmissionsBlocks(submissions),
		],
	} as View;
};
