import type {View} from '@slack/web-api';
import type {Theme} from '../types';

const themeDescription = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return `お題: *${theme.word}*（${theme.ruby}）`;
	}
	return `テーマ: *${theme.question}*`;
};

const inputLabel = (theme: Theme): string => {
	if (theme.type === 'dictionary') {
		return 'あなたが考えた「意味」を入力してください（最大256文字）';
	}
	return 'あなたが考えた「答え」を入力してください（最大256文字）';
};

export default (theme: Theme, gameType: 'normal' | 'daily'): View => ({
	type: 'modal',
	callback_id: gameType === 'normal' ? 'tahoiya_normal_submit_meaning_modal' : 'tahoiya_daily_submit_meaning_modal',
	title: {type: 'plain_text', text: '意味を登録する'},
	submit: {type: 'plain_text', text: '登録する'},
	blocks: [
		{
			type: 'section',
			text: {type: 'mrkdwn', text: themeDescription(theme)},
		},
		{
			type: 'input',
			block_id: 'meaning_input',
			label: {type: 'plain_text', text: inputLabel(theme)},
			element: {
				type: 'plain_text_input',
				action_id: 'meaning',
				multiline: true,
				max_length: 256,
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
