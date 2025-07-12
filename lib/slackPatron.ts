/** The interface for Slack Patron API */

import type {
	ConversationsHistoryArguments,
	ConversationsHistoryResponse,
	ConversationsRepliesArguments,
	ConversationsRepliesResponse,
} from '@slack/web-api';

const PATRON_API_HOST = process.env.SLACK_PATRON_API_HOST;

export const conversationsHistory = async (params: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse> => {
	if (!PATRON_API_HOST) {
		throw new Error('SLACK_PATRON_API_HOST environment variable is not set');
	}

	const url = new URL(`http://${PATRON_API_HOST}/api/conversations.history`);
	
	// Add query parameters
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined) {
			url.searchParams.append(key, String(value));
		}
	});

	const response = await fetch(url.toString());
	
	if (!response.ok) {
		throw new Error(`Patron API request failed: ${response.status} ${response.statusText}`);
	}

	return response.json() as Promise<ConversationsHistoryResponse>;
};

export const conversationsReplies = async (params: ConversationsRepliesArguments): Promise<ConversationsRepliesResponse> => {
	if (!PATRON_API_HOST) {
		throw new Error('SLACK_PATRON_API_HOST environment variable is not set');
	}

	const url = new URL(`http://${PATRON_API_HOST}/api/conversations.replies`);
	
	// Add query parameters
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined) {
			url.searchParams.append(key, String(value));
		}
	});

	const response = await fetch(url.toString());
	
	if (!response.ok) {
		throw new Error(`Patron API request failed: ${response.status} ${response.statusText}`);
	}

	return response.json() as Promise<ConversationsRepliesResponse>;
};