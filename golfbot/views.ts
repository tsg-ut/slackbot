import {KnownBlock, View} from '@slack/web-api';
import {plainText} from '../lib/slackUtils';
import config from './config';

export const createPostBlocks = (): KnownBlock[] => [
	{
		type: 'actions',
		block_id: 'golfbot_post',
		elements: [
			{
				type: 'button',
				text: plainText('Post a probelm'),
				action_id: 'post',
				value: 'post',
				style: 'primary',
			},
		],
	},
];

export const createPostView = (): View => ({
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
			},
		},
		{
			type: 'input',
			block_id: 'golfbot_post_date',
			label: plainText(`Date`),
			element: {
				type: 'datepicker',
				action_id: 'action',
			},
		},
		{
			type: 'input',
			block_id: 'golfbot_post_start_time',
			label: plainText(`Start time`),
			element: {
				type: 'timepicker', // time picker element is a beta feature
				action_id: 'action',
				initial_time: '15:00',
			} as any,
		},
		{
			type: 'input',
			block_id: 'golfbot_post_end_time',
			label: plainText(`End time`),
			element: {
				type: 'timepicker', // time picker element is a beta feature
				action_id: 'action',
				initial_time: '21:00',
			} as any,
		},
	],
});

export interface PostValues {
	problemURL: string;
	language: string;
	date: string;
	startTime: string;
	endTime: string;
}

export const getPostValues = (values: any): PostValues => ({
	problemURL: values['golfbot_post_problem_url']['action'].value,
	language: values['golfbot_post_language']['action'].selected_option.value,
	date: values['golfbot_post_date']['action'].selected_date,
	startTime: values['golfbot_post_start_time']['action'].selected_time,
	endTime: values['golfbot_post_end_time']['action'].selected_time,
});
