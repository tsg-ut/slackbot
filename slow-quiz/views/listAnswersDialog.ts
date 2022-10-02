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

	return 	{
		type: 'modal',
		callback_id: 'slowquiz_answer_question_dialog',
		title: {
			text: 'これまでの回答一覧',
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
						text: '出題者にだけ表示されています',
					},
				],
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `＊Q. ${game.question}＊`,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `＊A. ${game.answer} (${game.ruby})＊`,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: submissions.length === 0
						? 'まだ回答がありません'
						: submissions.map(formatSubmission).join('\n'),
				},
			},
		],
	} as View;
};
