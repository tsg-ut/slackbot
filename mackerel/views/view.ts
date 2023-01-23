import {ModalView} from '@slack/web-api';

import {
	kMackerelInviteStartBlockId,
	kMackerelInviteModalId,
	kMackerelEmailInputBlockId,
	kMackerelEmailInputActionId,
	botUsername,
	botIconEmoji,
} from '../const';

export const InviteStartMessageView = ({
	channelId,
}: {
	channelId: string,
}): any => ({
	channel: channelId,
	text: 'Go to Mackerel Invitation Form',
	username: botUsername,
	icon_emoji: botIconEmoji,
	blocks: [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: 'Mackerel Invitation',
				emoji: true,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'Mackerelのorgに招待します。あなたの所有する招待されたいEmailを入力してください。',
			},
		},
		{
			type: 'actions',
			block_id: kMackerelInviteStartBlockId,
			elements: [
				{
					type: 'button',
					text: {
						type: 'plain_text',
						emoji: true,
						text: 'Go',
					},
					style: 'primary',
					value: 'go',
				},
			],
		},
	],
});


export const Dialog = (): ModalView => ({
	type: 'modal',
	external_id: kMackerelInviteModalId,
	title: {
		type: 'plain_text',
		text: 'Mackerel',
		emoji: true,
	},
	submit: {
		type: 'plain_text',
		text: 'Submit',
		emoji: true,
	},
	close: {
		type: 'plain_text',
		text: 'Cancel',
		emoji: true,
	},
	blocks: [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: ':warning: *知らない人が招待されることになるので、まじでミスらないでください* :warning:',
			},
		},
		{
			type: 'input',
			block_id: kMackerelEmailInputBlockId,
			label: {
				type: 'plain_text',
				text: 'Enter your email...',
			},
			element: {
				type: 'email_text_input',
				action_id: kMackerelEmailInputActionId,
				focus_on_load: true,
				placeholder: {
					type: 'plain_text',
					emoji: true,
					text: 'me-and-you@example.com',
				},
			},
		},
	],
}) as ModalView;
