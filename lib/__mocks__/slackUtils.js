"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthorityLabel = exports.extractMessage = exports.isGenericMessage = exports.mrkdwn = exports.plainText = exports.getMemberIcon = exports.getMemberName = void 0;
exports.getMemberName = jest.fn(async () => 'Dummy User');
exports.getMemberIcon = jest.fn(async () => 'https://example.com/dummy.png');
const plainText = (text, emoji = true) => ({
    type: 'plain_text',
    text,
    emoji,
});
exports.plainText = plainText;
const mrkdwn = (text) => ({
    type: 'mrkdwn',
    text,
});
exports.mrkdwn = mrkdwn;
const isGenericMessage = (message) => {
    return message.subtype === undefined;
};
exports.isGenericMessage = isGenericMessage;
const extractMessage = (message) => {
    return message;
};
exports.extractMessage = extractMessage;
const getAuthorityLabel = () => {
    return 'TEST_AUTHORITY';
};
exports.getAuthorityLabel = getAuthorityLabel;
