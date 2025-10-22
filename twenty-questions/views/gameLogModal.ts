import type {KnownBlock, View} from '@slack/web-api';
import {sortBy} from 'lodash';
import type {FinishedGame} from '../TwentyQuestions';

export default (game: FinishedGame): View => {
	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: `お題: ${game.topic}`,
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*【データシート】*\n${game.topicDescription}`,
			},
		},
		{
			type: 'divider',
		},
	];

	// 正解者を質問回数順にソート
	const correctPlayers = sortBy(
		game.players.filter((p) => p.score !== null),
		(p) => p.score,
	);

	// 未正解者（質問したが正解できなかった）
	const failedPlayers = game.players.filter(
		(p) => p.questionCount > 0 && p.score === null,
	);

	// 全てのプレイヤーを表示（正解者が先）
	const allPlayers = [...correctPlayers, ...failedPlayers];

	if (allPlayers.length === 0) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: '参加者がいません。',
			},
		});
	} else {
		for (const player of allPlayers) {
			const statusEmoji = player.score !== null ? '✅' : '❌';
			const statusText =
				player.score !== null
					? `${player.score}問で正解`
					: '不正解';

			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `${statusEmoji} *<@${player.userId}>* (${statusText})`,
				},
			});

			if (player.questions.length > 0) {
				const questionsText = player.questions
					.map((q, i) => {
						if (q.isAnswerAttempt) {
							const emoji = q.isCorrect ? ':white_check_mark:' : ':x:';
							return `${emoji} ${q.question}\n${q.answer}`;
						}
						return `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.answer}`;
					})
					.join('\n\n');

				blocks.push({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: questionsText,
					},
				});
			} else {
				blocks.push({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: '_質問履歴なし_',
					},
				});
			}

			blocks.push({
				type: 'divider',
			});
		}
	}

	return {
		type: 'modal',
		title: {
			text: 'ゲームログ',
			type: 'plain_text',
		},
		close: {
			text: '閉じる',
			type: 'plain_text',
		},
		blocks,
	};
};
