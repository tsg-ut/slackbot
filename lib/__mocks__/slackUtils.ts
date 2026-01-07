/* eslint-env node, jest */
import { MessageEvent } from '@slack/bolt';
import { GenericMessageEvent } from '@slack/web-api';

export const isGenericMessage = (message: MessageEvent): message is GenericMessageEvent => {
    return message.subtype === undefined;
};

export const extractMessage = (message: MessageEvent) => {
    return message as GenericMessageEvent;
};

// Mock other functions that might be used
export const getMemberName = jest.fn(async () => 'Dummy User');
export const getMemberIcon = jest.fn(async () => 'https://example.com/dummy.png');
export const plainText = jest.fn((text: string) => ({ type: 'plain_text', text, emoji: true }));
export const mrkdwn = jest.fn((text: string) => ({ type: 'mrkdwn', text }));
