"use strict";
/** The interface for Slack Patron API */
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationsReplies = exports.conversationsHistory = void 0;
const PATRON_API_HOST = process.env.SLACK_PATRON_API_HOST;
const conversationsHistory = async (params) => {
    if (!PATRON_API_HOST) {
        throw new Error('SLACK_PATRON_API_HOST environment variable is not set');
    }
    const url = new URL(`http://${PATRON_API_HOST}/api/conversations.history`);
    // Add query parameters
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.append(key, String(value));
        }
    }
    const response = await fetch(url.toString(), { method: 'POST' });
    if (!response.ok) {
        throw new Error(`Patron API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
};
exports.conversationsHistory = conversationsHistory;
const conversationsReplies = async (params) => {
    if (!PATRON_API_HOST) {
        throw new Error('SLACK_PATRON_API_HOST environment variable is not set');
    }
    const url = new URL(`http://${PATRON_API_HOST}/api/conversations.replies`);
    // Add query parameters
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            url.searchParams.append(key, String(value));
        }
    }
    const response = await fetch(url.toString(), { method: 'POST' });
    if (!response.ok) {
        throw new Error(`Patron API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
};
exports.conversationsReplies = conversationsReplies;
