import {getEmoji, getMemberIcon, getMemberName} from '../lib/slackUtils';

export const getUserMention = (userId: string) => {
	if (userId.startsWith('bot:')) {
		const botId = userId.replace(/^bot:/, '');
		return `＊${botId}＊`;
	}
	return `<@${userId}>`;
};

export const getUserIcon = (userId: string) => {
	if (userId.startsWith('bot:')) {
		return getEmoji('chatgpt', process.env.TEAM_ID);
	}
	return getMemberIcon(userId);
};

export const getUserName = (userId: string) => {
	if (userId.startsWith('bot:')) {
		const botId = userId.replace(/^bot:/, '');
		return botId;
	}
	return getMemberName(userId);
};


