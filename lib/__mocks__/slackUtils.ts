/* eslint-env node, jest */
import {MrkdwnElement, PlainTextElement} from '@slack/web-api';
import type {MessageEvent} from '@slack/bolt';

export const getMemberName = jest.fn(async () => 'Dummy User');
export const getMemberIcon = jest.fn(async () => 'https://example.com/dummy.png');

export const plainText = (text: string, emoji: boolean = true): PlainTextElement => ({
	type: 'plain_text' as 'plain_text',
	text,
	emoji,
});

export const mrkdwn = (text: string): MrkdwnElement => ({
	type: 'mrkdwn' as 'mrkdwn',
	text,
});

export const extractMessage = (message: MessageEvent) => {
	return message;
};