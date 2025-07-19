import type {View} from '@slack/web-api';
import type {TahoiyaMeaning} from './types';

export const meaningCollectionDialog = (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_meaning_dialog',
	title: {
		type: 'plain_text',
		text: 'たほいや - 意味を登録',
	},
	submit: {
		type: 'plain_text',
		text: '登録',
	},
	close: {
		type: 'plain_text',
		text: 'キャンセル',
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'お題の単語の意味を考えて入力してください。',
			},
		},
		{
			type: 'input',
			block_id: 'meaning_input',
			element: {
				type: 'plain_text_input',
				action_id: 'meaning',
				placeholder: {
					type: 'plain_text',
					text: '意味を入力してください',
				},
				multiline: true,
				max_length: 256,
			},
			label: {
				type: 'plain_text',
				text: '意味',
			},
		},
	],
});

export const bettingDialog = (shuffledMeanings: TahoiyaMeaning[]): View => ({
	type: 'modal',
	callback_id: 'tahoiya_betting_dialog',
	title: {
		type: 'plain_text',
		text: 'たほいや - ベッティング',
	},
	submit: {
		type: 'plain_text',
		text: 'BET',
	},
	close: {
		type: 'plain_text',
		text: 'キャンセル',
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: '正しい意味だと思うものを選んでBETしてください。',
			},
		},
		{
			type: 'input',
			block_id: 'meaning_select',
			element: {
				type: 'radio_buttons',
				action_id: 'meaning',
				options: shuffledMeanings.map((meaning, index) => ({
					text: {
						type: 'plain_text',
						text: `${index + 1}. ${meaning.text}`,
					},
					value: index.toString(),
				})),
			},
			label: {
				type: 'plain_text',
				text: '意味を選択',
			},
		},
		{
			type: 'input',
			block_id: 'coins_input',
			element: {
				type: 'static_select',
				action_id: 'coins',
				placeholder: {
					type: 'plain_text',
					text: 'BET枚数を選択',
				},
				options: [
					{
						text: {
							type: 'plain_text',
							text: '1枚',
						},
						value: '1',
					},
					{
						text: {
							type: 'plain_text',
							text: '2枚',
						},
						value: '2',
					},
					{
						text: {
							type: 'plain_text',
							text: '3枚',
						},
						value: '3',
					},
					{
						text: {
							type: 'plain_text',
							text: '4枚',
						},
						value: '4',
					},
					{
						text: {
							type: 'plain_text',
							text: '5枚',
						},
						value: '5',
					},
				],
			},
			label: {
				type: 'plain_text',
				text: 'BET枚数',
			},
		},
	],
});

export const themeRegistrationDialog = (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_theme_registration_dialog',
	title: {
		type: 'plain_text',
		text: 'デイリーたほいや - お題登録',
	},
	submit: {
		type: 'plain_text',
		text: '登録',
	},
	close: {
		type: 'plain_text',
		text: 'キャンセル',
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'デイリーたほいやのお題を登録してください。',
			},
		},
		{
			type: 'input',
			block_id: 'word_input',
			element: {
				type: 'plain_text_input',
				action_id: 'word',
				placeholder: {
					type: 'plain_text',
					text: '単語を入力してください',
				},
			},
			label: {
				type: 'plain_text',
				text: '単語',
			},
		},
		{
			type: 'input',
			block_id: 'ruby_input',
			element: {
				type: 'plain_text_input',
				action_id: 'ruby',
				placeholder: {
					type: 'plain_text',
					text: '読み仮名を入力してください',
				},
			},
			label: {
				type: 'plain_text',
				text: '読み仮名（ひらがな）',
			},
		},
		{
			type: 'input',
			block_id: 'meaning_input',
			element: {
				type: 'plain_text_input',
				action_id: 'meaning',
				placeholder: {
					type: 'plain_text',
					text: '意味を入力してください',
				},
				multiline: true,
				max_length: 256,
			},
			label: {
				type: 'plain_text',
				text: '意味',
			},
		},
		{
			type: 'input',
			block_id: 'source_input',
			element: {
				type: 'plain_text_input',
				action_id: 'source',
				placeholder: {
					type: 'plain_text',
					text: 'ソースを入力してください',
				},
			},
			label: {
				type: 'plain_text',
				text: 'ソース',
			},
		},
		{
			type: 'input',
			block_id: 'url_input',
			element: {
				type: 'plain_text_input',
				action_id: 'url',
				placeholder: {
					type: 'plain_text',
					text: 'URLを入力してください',
				},
			},
			label: {
				type: 'plain_text',
				text: 'URL',
			},
		},
	],
});

export const commentDialog = (): View => ({
	type: 'modal',
	callback_id: 'tahoiya_comment_dialog',
	title: {
		type: 'plain_text',
		text: 'たほいや - コメント',
	},
	submit: {
		type: 'plain_text',
		text: '送信',
	},
	close: {
		type: 'plain_text',
		text: 'キャンセル',
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'コメントを入力してください。',
			},
		},
		{
			type: 'input',
			block_id: 'comment_input',
			element: {
				type: 'plain_text_input',
				action_id: 'comment',
				placeholder: {
					type: 'plain_text',
					text: 'コメントを入力してください',
				},
				multiline: true,
				max_length: 500,
			},
			label: {
				type: 'plain_text',
				text: 'コメント',
			},
		},
	],
});
