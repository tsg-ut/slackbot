import {View} from '@slack/web-api';
import {stripIndent} from 'common-tags';

export default {
	type: 'modal',
	callback_id: 'slowquiz_register_quiz_dialog',
	title: {
		text: 'クイズ登録',
		type: 'plain_text',
	},
	submit: {
		text: '登録する',
		type: 'plain_text',
	},
	notify_on_close: true,
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: stripIndent`
					問題の投稿にあたっては、一般的な早押しクイズのガイドラインに配慮し、不自然な問題文、不自然な表記、極端に短い・長い問題文などの問題を避けるようにしてください。
					また、このクイズの性質上なるべく早い段階で答えが確定する問題文が好ましいですが、必ずしも従う必要はありません。

					早押しクイズ 作問ガイドラインの例
					● <https://cdn.tactosh.com/quiz/guideline/question.html|みんなで早押しクイズ 作問ガイドライン>
					● <https://www.dropbox.com/s/c3mlanb17yk2ol0/abc_EQIDEN%20%E5%95%8F%E9%A1%8C%E4%BD%9C%E6%88%90%E3%81%AE%E6%89%8B%E5%BC%95%E3%81%8D.pdf?dl=0|abc/EQIDEN 問題作成の手引き>
					● <https://drive.google.com/file/d/10tUZdWtTU8UF6nUoKSjlbvEU_i779jpa/view|beyond the text>
				`,
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '問題',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'question',
				placeholder: {
					type: 'plain_text',
					text: '日本一高い山は何でしょう？',
				},
				multiline: true,
				max_length: 90,
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '答え',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'answer',
				placeholder: {
					type: 'plain_text',
					text: '富士山',
				},
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: '読みがな',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'ruby',
				placeholder: {
					type: 'plain_text',
					text: 'ふじさん',
				},
			},
			hint: {
				type: 'plain_text',
				text: stripIndent`
					回答に使用します。ひらがな・カタカナ・英数字のみ使用することができます。
					「,」(半角カンマ)で区切ることで別解を指定することができます。
				`,
			},
		},
		{
			type: 'input',
			label: {
				type: 'plain_text',
				text: 'ヒント',
			},
			element: {
				type: 'plain_text_input',
				action_id: 'hint',
				placeholder: {
					type: 'plain_text',
					text: 'かな4文字・最も一般的な名称で回答',
				},
			},
			hint: {
				type: 'plain_text',
				text: '回答が一意に定まるようなヒントを入力してください',
			},
			optional: true,
		},
	],
} as View;
