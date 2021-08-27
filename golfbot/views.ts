import {KnownBlock, View} from '@slack/web-api';
import {plainText} from '../lib/slackUtils';
import config from './config';

export const createEditBlocks = (): KnownBlock[] => [
	{
		type: 'actions',
		block_id: 'golfbot_edit',
		elements: [
			{
				type: 'button',
				text: plainText('Edit'),
				action_id: 'edit',
				value: 'edit',
			},
		],
	},
];

export interface PostValues {
	problemURL: string;
	language: string;
	date: string;
	startTime: string;
	endTime: string;
}

export const createPostView = (initialValues: Partial<PostValues> = {}): View => ({
	type: 'modal',
	callback_id: 'golfbot_post',
	title: plainText(`Post a problem`),
	submit: plainText(`Post`),
	blocks: [
		{
			type: 'input',
			block_id: 'golfbot_post_problem_url',
			label: plainText(`Problem URL`),
			element: {
				type: 'plain_text_input',
				action_id: 'action',
				placeholder: plainText(`https://atcoder.jp/contests/abc187/tasks/abc187_a`),
				...(initialValues.problemURL ? {initial_value: initialValues.problemURL} : {}),
			},
		},
		{
			type: 'input',
			block_id: 'golfbot_post_language',
			label: plainText('Language'),
			element: {
				type: 'static_select',
				action_id: 'action',
				options: config.atcoder.languages.map(l => ({
					text: plainText(l.name),
					value: l.id,
				})),
				...(initialValues.language
					? {
							initial_option: {
								text: plainText(config.atcoder.languages.find(l => l.id === initialValues.language)!.name),
								value: initialValues.language,
							},
					  }
					: {}),
			},
		},
		{
			type: 'input',
			block_id: 'golfbot_post_date',
			label: plainText(`Date`),
			element: {
				type: 'datepicker',
				action_id: 'action',
				...(initialValues.date ? {initial_date: initialValues.date} : {}),
			},
		},
		{
			type: 'input',
			block_id: 'golfbot_post_start_time',
			label: plainText(`Start time`),
			element: {
				type: 'timepicker', // time picker element is a beta feature
				action_id: 'action',
				...(initialValues.startTime ? {initial_time: initialValues.startTime} : {initial_time: '15:00'}),
			} as any,
		},
		{
			type: 'input',
			block_id: 'golfbot_post_end_time',
			label: plainText(`End time`),
			element: {
				type: 'timepicker', // time picker element is a beta feature
				action_id: 'action',
				...(initialValues.endTime ? {initial_time: initialValues.endTime} : {initial_time: '21:00'}),
			} as any,
		},
	],
});

export const getPostValues = (values: any): PostValues => ({
	problemURL: values['golfbot_post_problem_url']['action'].value,
	language: values['golfbot_post_language']['action'].selected_option.value,
	date: values['golfbot_post_date']['action'].selected_date,
	startTime: values['golfbot_post_start_time']['action'].selected_time,
	endTime: values['golfbot_post_end_time']['action'].selected_time,
});
