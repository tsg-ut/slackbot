import type {KnownBlock} from '@slack/web-api';
import type {StateObj} from '../TwentyQuestions.js';
import {getRankedPlayers} from '../rankingUtils.js';

export default (state: StateObj): KnownBlock[] => {
	const {currentGame} = state;

	if (!currentGame) {
		return [
			{
				type: 'header',
				text: {
					type: 'plain_text',
					text: '20の扉',
					emoji: true,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: '現在進行中のゲームはありません。',
				},
			},
		];
	}

	const statusText = currentGame.status === 'active' ? '参加受付中' : '終了';

	const correctPlayers = Object.values(currentGame.players).filter((p) => p.score !== null);

	// 1回でも質問・回答したが正解していないプレイヤー
	const failedPlayers = Object.values(currentGame.players).filter(
		(p) => p.questionCount > 0 && p.score === null,
	);

	let rankingText = '';
	if (correctPlayers.length === 0 && failedPlayers.length === 0) {
		rankingText = 'まだ参加者はいません。';
	} else {
		if (correctPlayers.length > 0) {
			const rankedPlayers = getRankedPlayers(correctPlayers);
			rankingText = rankedPlayers
				.map(({player, displayRank}) => `${displayRank}: <@${player.userId}> (${player.score}問)`)
				.join('\n');
		} else {
			rankingText = 'まだ正解者はいません。';
		}

		if (failedPlayers.length > 0) {
			const failedText = failedPlayers
				.map((p) => `<@${p.userId}>`)
				.join(', ');
			rankingText += `\n\n＊未正解:＊ ${failedText}`;
		}
	}

	const blocks: KnownBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '🚪🚪🚪🚪🚪🚪🚪🚪🚪\n🚪　20の扉ゲーム　🚪\n🚪🚪🚪🚪🚪🚪🚪🚪🚪',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text:
					'＊ルール:＊\n' +
					'• AIが選んだお題の単語を当てるゲームです\n' +
					'• 「はい」「いいえ」で答えられる質問を最大20回できます\n' +
					'• なるべく少ない質問回数で正解を目指そう！\n' +
					'• ゲームは30分で自動終了します',
			},
		},
		{
			type: 'divider',
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `＊現在の状態:＊ ${statusText}`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: '＊ランキング:＊\n' + rankingText,
			},
		},
	];

	if (currentGame.status === 'active') {
		blocks.push({
			type: 'actions',
			elements: [
				{
					type: 'button',
					text: {
						type: 'plain_text',
						text: '参加する',
						emoji: true,
					},
					action_id: 'twenty_questions_join_button',
					style: 'primary',
				},
			],
		});
	} else {
		blocks.push(
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `＊正解:＊ ${currentGame.topic}`,
				},
			},
			{
				type: 'actions',
				elements: [
					{
						type: 'button',
						text: {
							type: 'plain_text',
							text: 'ログを確認する',
							emoji: true,
						},
						action_id: 'twenty_questions_view_log_button',
						value: currentGame.id,
						style: 'primary',
					},
				],
			},
		);
	}

	return blocks;
};
