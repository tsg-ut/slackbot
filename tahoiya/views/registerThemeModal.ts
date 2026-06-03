import type {View} from '@slack/web-api';

const REGULATION_URL = 'https://scrapbox.io/tsg/%E3%83%87%E3%82%A4%E3%83%AA%E3%83%BC%E3%81%9F%E3%81%BB%E3%81%84%E3%82%84';

// Step 1: mode selection
export const registerThemeModeSelectModal = (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_register_theme_mode_select',
	title: {type: 'plain_text', text: 'お題登録 - モード選択'},
	close: {type: 'plain_text', text: 'キャンセル'},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `デイリーたほいやのお題を登録します。\nレギュレーション: <${REGULATION_URL}|デイリーたほいや>\n\n登録するお題のモードを選択してください。`,
			},
		},
		{
			type: 'actions',
			elements: [
				{
					type: 'button',
					text: {type: 'plain_text', text: '📖 辞書モード', emoji: true},
					action_id: 'tahoiya_theme_mode_dict',
					style: 'primary',
				},
				{
					type: 'button',
					text: {type: 'plain_text', text: '✨ 任意モード', emoji: true},
					action_id: 'tahoiya_theme_mode_arbitrary',
				},
			],
		},
		{
			type: 'context',
			elements: [
				{
					type: 'mrkdwn',
					text: '辞書モード: 実際の辞書にある単語とその意味を登録します。\n任意モード: 任意のテーマと正解を登録します（例: 「実在するPerfumeのシングルは?」「さよならプラスティックワールド」）',
				},
			],
		},
	],
});

// Step 2a: dictionary form
export const registerThemeDictModal = (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_register_theme_dict_modal',
	title: {type: 'plain_text', text: 'お題登録 - 辞書モード'},
	submit: {type: 'plain_text', text: '登録する'},
	close: {type: 'plain_text', text: '戻る'},
	blocks: [
		{
			type: 'input',
			block_id: 'word_input',
			label: {type: 'plain_text', text: '単語（漢字表記）'},
			element: {
				type: 'plain_text_input',
				action_id: 'word',
				placeholder: {type: 'plain_text', text: '例: 擬骨'},
			},
		},
		{
			type: 'input',
			block_id: 'ruby_input',
			label: {type: 'plain_text', text: '読み（ひらがなのみ）'},
			element: {
				type: 'plain_text_input',
				action_id: 'ruby',
				placeholder: {type: 'plain_text', text: '例: ぎこつ'},
			},
		},
		{
			type: 'input',
			block_id: 'meaning_input',
			label: {type: 'plain_text', text: '意味（辞書の正しい意味）'},
			element: {
				type: 'plain_text_input',
				action_id: 'meaning',
				multiline: true,
				placeholder: {type: 'plain_text', text: '例: 骨格に似た形状の植物など'},
			},
		},
		{
			type: 'input',
			block_id: 'source_input',
			label: {type: 'plain_text', text: '出典'},
			element: {
				type: 'plain_text_input',
				action_id: 'source',
				placeholder: {type: 'plain_text', text: '例: 広辞苑、Wikipedia など'},
			},
		},
		{
			type: 'input',
			block_id: 'url_input',
			label: {type: 'plain_text', text: 'URL（出典ページ）'},
			element: {
				type: 'plain_text_input',
				action_id: 'url',
				placeholder: {type: 'plain_text', text: 'https://...'},
			},
		},
	],
});

// Step 2b: arbitrary form
export const registerThemeArbitraryModal = (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_register_theme_arbitrary_modal',
	title: {type: 'plain_text', text: 'お題登録 - 任意モード'},
	submit: {type: 'plain_text', text: '登録する'},
	close: {type: 'plain_text', text: '戻る'},
	blocks: [
		{
			type: 'input',
			block_id: 'question_input',
			label: {type: 'plain_text', text: 'お題文'},
			element: {
				type: 'plain_text_input',
				action_id: 'question',
				placeholder: {type: 'plain_text', text: '例: 実在するPerfumeのシングルは?'},
			},
		},
		{
			type: 'input',
			block_id: 'answer_input',
			label: {type: 'plain_text', text: '正解'},
			element: {
				type: 'plain_text_input',
				action_id: 'answer',
				placeholder: {type: 'plain_text', text: '例: さよならプラスティックワールド'},
			},
		},
		{
			type: 'input',
			block_id: 'url_input',
			label: {type: 'plain_text', text: 'URL（正解が確認できるページ）'},
			element: {
				type: 'plain_text_input',
				action_id: 'url',
				placeholder: {type: 'plain_text', text: 'https://...'},
			},
		},
	],
});
