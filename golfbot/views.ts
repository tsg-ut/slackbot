import {KnownBlock, MessageAttachment, Option, PlainTextElement, View} from '@slack/web-api';
import {mrkdwn, plainText} from '../lib/slackUtils';
import config from './config';

// https://api.slack.com/reference/surfaces/formatting#escaping
const escapeText = (text: string): string => {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
};

export const createEditBlocks = (): KnownBlock[] => [
	{
		type: 'actions',
		block_id: 'golfbot_edit',
		elements: [
			{
				type: 'button',
				text: plainText('編集'),
				action_id: 'edit',
				value: 'edit',
			},
		],
	},
];

export interface PostValues {
	service: 'atcoder' | 'anagol';
	problemURL: string;
	language: string;
	date: string;
	startTime: string;
	endTime: string;
}

export const createPostView = (initialValues: Partial<PostValues> = {}): View => {
	const service = initialValues.service ?? 'atcoder';

	const languageOptions: Option[] = config[service].languages.map(l => ({
		text: plainText(escapeText(l.name)),
		value: l.id,
	}));

	// maximum number of options is 100
	const languageOptionGroups: {
		label: PlainTextElement;
		options: Option[];
	}[] = [];
	for (let i = 0; i * 100 < languageOptions.length; i++) {
		languageOptionGroups.push({
			label: plainText(`Group ${i + 1}`),
			options: languageOptions.slice(i * 100, (i + 1) * 100),
		});
	}

	return {
		type: 'modal',
		callback_id: 'golfbot_post',
		title: plainText(`コンテストを追加する`),
		submit: plainText(`追加`),
		blocks: [
			{
				type: 'section',
				block_id: 'golfbot_post_service',
				text: mrkdwn(`*形式*`),
				accessory: {
					type: 'static_select',
					action_id: 'action',
					options: [
						{
							text: plainText(config['atcoder'].name),
							value: 'atcoder',
						},
						{
							text: plainText(config['anagol'].name),
							value: 'anagol',
						},
					],
					initial_option: {
						text: plainText(config[service].name),
						value: service,
					},
				},
			},
			{
				type: 'input',
				block_id: 'golfbot_post_problem_url',
				label: plainText(`問題 URL`),
				element: {
					type: 'plain_text_input',
					action_id: 'action',
					placeholder: plainText(
						{
							atcoder: `https://atcoder.jp/contests/abc187/tasks/abc187_a`,
							anagol: `http://golf.shinh.org/p.rb?delete+blank+lines`,
						}[service]
					),
					...(initialValues.problemURL ? {initial_value: initialValues.problemURL} : {}),
				},
			},
			{
				type: 'input',
				block_id: 'golfbot_post_language',
				label: plainText('言語'),
				element: {
					type: 'static_select',
					action_id: 'action',
					...(languageOptionGroups.length === 1 ? {options: languageOptions} : {option_groups: languageOptionGroups}),
					...(initialValues.language ? {initial_option: languageOptions.find(l => l.value === initialValues.language)} : {}),
				},
			},
			{
				type: 'input',
				block_id: 'golfbot_post_date',
				label: plainText(`日にち`),
				element: {
					type: 'datepicker',
					action_id: 'action',
					...(initialValues.date ? {initial_date: initialValues.date} : {}),
				},
			},
			{
				type: 'input',
				block_id: 'golfbot_post_start_time',
				label: plainText(`開始時刻`),
				element: {
					type: 'timepicker', // time picker element is a beta feature
					action_id: 'action',
					...(initialValues.startTime ? {initial_time: initialValues.startTime} : {initial_time: '15:00'}),
				} as any,
			},
			{
				type: 'input',
				block_id: 'golfbot_post_end_time',
				label: plainText(`終了時刻`),
				element: {
					type: 'timepicker', // time picker element is a beta feature
					action_id: 'action',
					...(initialValues.endTime ? {initial_time: initialValues.endTime} : {initial_time: '21:00'}),
				} as any,
			},
		],
	};
};

export const getPostValues = (values: any): PostValues => ({
	service: values['golfbot_post_service']['action'].selected_option.value,
	problemURL: values['golfbot_post_problem_url']['action'].value ?? '',
	language: values['golfbot_post_language']['action'].selected_option?.value ?? '',
	date: values['golfbot_post_date']['action'].selected_date,
	startTime: values['golfbot_post_start_time']['action'].selected_time,
	endTime: values['golfbot_post_end_time']['action'].selected_time,
});
