import type {KnownBlock} from '@slack/web-api';
import {sortBy} from 'lodash';
import type {Game, Submission} from '../..';
import {getUserMention} from '../../util';

type UserSubmission = Submission & { type: 'wrong_answer' | 'correct_answer' | 'comment' }

const formatSubmission = ({days, type, user, answer}: UserSubmission, showUser: boolean) => {
	if (type === 'wrong_answer') {
		return `${days}日目: ${showUser ? `${getUserMention(user)} ` : ''}＊解答「${answer}」＊ → 不正解`;
	}
	if (type === 'correct_answer') {
		return `${days}日目: ${showUser ? `${getUserMention(user)} ` : ''}＊解答「${answer}」＊ → 正解`;
	}
	return `${days}日目: ${showUser ? `${getUserMention(user)} ` : ''}${answer}`;
};

export const getSubmissionsBlocks = (game: Game, filterUserId: string | null) => {
	const userSubmissions = sortBy([
		...game.wrongAnswers.map((answer) => ({...answer, type: 'wrong_answer'} as UserSubmission)),
		...game.correctAnswers.map((answer) => ({...answer, type: 'correct_answer'} as UserSubmission)),
		...game.comments.map((comment) => ({...comment, type: 'comment'} as UserSubmission)),
	], (submission) => submission.date ?? 0);

	const blocks: KnownBlock[] = [];
	let text = '';
	for (const submission of userSubmissions) {
		if (filterUserId && submission.user !== filterUserId) {
			continue;
		}

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
		text += formatSubmission(submission, filterUserId === null);
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

	if (blocks.length === 0) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'まだ解答がありません',
			},
		});
	}

	return blocks;
};
