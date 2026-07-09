import type {View} from '@slack/web-api';
import type {GameComment, Theme} from '../types.js';

const themeDescription = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `お題: ＊${theme.ruby}＊`;
	}
	return `質問: ＊${theme.question}＊`;
};

const inputLabel = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return 'あなたが考えた「意味」を入力してください（最大256文字）';
	}
	return 'あなたが考えた「誤答選択肢」を入力してください（最大256文字）';
};

export default (theme: Theme, gameType: 'normal' | 'daily', initialValue?: string, userComments: GameComment[] = []): View => ({
	type: 'modal',
	callback_id: gameType === 'normal' ? 'tahoiya_normal_submit_meaning_modal' : 'tahoiya_daily_submit_meaning_modal',
	title: {type: 'plain_text', text: '意味を登録する'},
	submit: {type: 'plain_text', text: '登録する'},
	blocks: [
		{
			type: 'section',
			text: {type: 'mrkdwn', text: themeDescription(theme)},
		},
		...(theme.type === 'arbitrary' ? [{
			type: 'context' as const,
			elements: [{
				type: 'mrkdwn' as const,
				text: (theme.isMimicryAllowed ?? false)
					? 'このたほいやは任意お題モードです。この質問に対して他の参加者を騙すことができるような、誤答選択肢を作成するか、または正解となる選択肢を登録することができます。'
					: 'このたほいやは任意お題モードです。この質問に対して他の参加者を騙すことができるような、誤答選択肢を想像で作成してください。質問に対する正解となる選択肢を意図的に登録することはレギュレーション違反となります。',
			}],
		}] : []),
		{
			type: 'input',
			block_id: 'meaning_input',
			label: {type: 'plain_text', text: inputLabel(theme)},
			element: {
				type: 'plain_text_input',
				action_id: 'meaning',
				multiline: true,
				max_length: 256,
				...(initialValue ? {initial_value: initialValue} : {}),
				placeholder: {
					type: 'plain_text',
					text: theme.type === 'dictionary'
						? '例: 高山に自生する植物の一種で...'
						: '例: さよならプラスティックワールド',
				},
			},
		},
		{type: 'divider'},
		...(userComments.length > 0 ? [{
			type: 'section' as const,
			text: {
				type: 'mrkdwn' as const,
				text: `*あなたのコメント:*\n${userComments.map((c) => `> ${c.text}`).join('\n')}`,
			},
		}] : []),
		{
			type: 'input',
			block_id: 'comment_input',
			optional: true,
			label: {type: 'plain_text', text: 'コメント（ゲーム終了まで非公開）'},
			element: {
				type: 'plain_text_input',
				action_id: 'comment_text',
				multiline: true,
				max_length: 500,
				placeholder: {type: 'plain_text', text: 'ゲームについてのコメントを入力...'},
			},
		},
		{
			type: 'actions',
			block_id: 'comment_actions',
			elements: [{
				type: 'button',
				action_id: `tahoiya_${gameType}_comment_button`,
				text: {type: 'plain_text', text: 'コメントを送信', emoji: true},
			}],
		},
	],
});
