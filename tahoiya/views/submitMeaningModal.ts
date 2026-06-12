import type {View} from '@slack/web-api';
import type {Theme} from '../types';

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

export default (theme: Theme, gameType: 'normal' | 'daily', initialValue?: string): View => ({
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
				text: 'このたほいやは任意お題モードです。この質問に対して他の参加者を騙すことができるような、誤答選択肢を想像で作成してください。質問に対する正解となる選択肢を意図的に登録することはレギュレーション違反となります。',
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
	],
});
