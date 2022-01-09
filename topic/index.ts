import type {Message} from '@slack/web-api/dist/response/ConversationsHistoryResponse';
import {increment} from '../achievements';
import type {SlackInterface} from '../lib/slack';
import {getReactions} from '../lib/slackUtils';
import State from '../lib/state';

const isQualifiableMessage = (message: Message) => {
	if (message?.attachments?.length > 0) {
		return false;
	}
	if (message?.files?.length > 0) {
		return false;
	}
	if (message?.subtype === 'bot_message' && message?.blocks?.length > 0) {
		return false;
	}

	const text = message.text || '';
	const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
	if (lines.length !== 1) {
		return false;
	}

	const [line] = lines;
	const lineLength = Buffer.from(line).length;
	return lineLength >= 1 && lineLength <= 100;
};

interface StateObj {
	processedMessages: string[],
}

export default async ({eventClient, webClient: slack}: SlackInterface) => {
	const state = await State.init<StateObj>('topic', {processedMessages: []});

	const getTopic = async () => {
		const res = await slack.conversations.info({
			channel: process.env.CHANNEL_SANDBOX,
		});
		return res?.channel?.topic?.value || '';
	};

	const updateTopic = async (newTopic: string) => {
		const currentTopicText = await getTopic();
		const [headline, ...currentTopics] = currentTopicText.split('/').map((topic) => topic.trim());
		let topicText = '';
		const topics = [headline];
		for (const topic of [newTopic, ...currentTopics]) {
			topics.push(topic);
			const newTopicText = topics.join(' / ');
			if (Buffer.from(newTopicText).length > 250) {
				break;
			}
			topicText = newTopicText;
		}

		await slack.conversations.setTopic({
			token: process.env.HAKATASHI_TOKEN,
			channel: process.env.CHANNEL_SANDBOX,
			topic: topicText,
		});
	};

	const processedMessages = new Set(state.processedMessages);

	eventClient.on('reaction_added', async (event) => {
		if (
			event.reaction !== 'koresuki' ||
			event.item.channel !== process.env.CHANNEL_SANDBOX ||
			processedMessages.has(event.item.ts)
		) {
			return;
		}

		const reactions = await getReactions(event.item.channel, event.item.ts);
		if (reactions.koresuki < 5) {
			return;
		}

		const res = await slack.conversations.history({
			token: process.env.HAKATASHI_TOKEN,
			channel: event.item.channel,
			latest: event.item.ts,
			limit: 1,
			inclusive: true,
		});

		// race condition
		if (processedMessages.has(event.item.ts)) {
			return;
		}

		const message = res?.messages?.[0];
		if (message === undefined) {
			return;
		}

		processedMessages.add(event.item.ts);
		state.processedMessages.push(event.item.ts);
		if (!isQualifiableMessage(message)) {
			return;
		}

		increment(message.user, 'topic-adopted');
		updateTopic(message.text.trim());
	});
};
