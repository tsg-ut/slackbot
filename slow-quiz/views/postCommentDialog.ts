import {View} from '@slack/web-api';
import {stripIndent} from 'common-tags';
import type {Game, Submission} from '../index';

type UserSubmission = Submission & {type: 'wrong_answer' | 'correct_answer' | 'comment'}

const formatSubmission = (submission: UserSubmission) => {
	if (submission.type === 'wrong_answer') {
		return `${submission.days}日目: ＊解答「${submission.answer}」＊ → 不正解`;
	}
	if (submission.type === 'correct_answer') {
		return `${submission.days}日目: ＊解答「${submission.answer}」＊ → 正解`;
	}
	return `${submission.days}日目: ${submission.answer}`;
};

export default (game: Game, user: string) => {
	const submissions = [
		...game.wrongAnswers.map((answer) => ({...answer, type: 'wrong_answer'} as UserSubmission)),
		...game.correctAnswers.map((answer) => ({...answer, type: 'correct_answer'} as UserSubmission)),
		...game.comments.map((comment) => ({...comment, type: 'comment'} as UserSubmission)),
	];

	const userSubmissions = submissions
		.filter((submission) => submission.user === user)
		.sort((a, b) => a.date - b.date);


	return {
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
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: userSubmissions.length === 0
						? 'まだ解答がありません'
						: userSubmissions.map(formatSubmission).join('\n'),
				},
			},
			{
				type: 'input',
				element: {
					type: 'plain_text_input',
					multiline: true,
					action_id: 'slowquiz_post_comment_input_comment',
				},
				label: {
					type: 'plain_text',
					text: 'コメント',
					emoji: true,
				},
				hint: {
					type: 'plain_text',
					text: 'クイズ終了まで公開されません',
				},
			},
			{
				type: 'actions',
				elements: [
					{
						type: 'button',
						text: {
							type: 'plain_text',
							text: '投稿する',
							emoji: true,
						},
						action_id: 'slowquiz_post_comment_submit_comment',
						style: 'primary',
					},
				],
			},
		],
	} as View;
};
