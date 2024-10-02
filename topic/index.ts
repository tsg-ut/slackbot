import type {GenericMessageEvent} from '@slack/bolt';
import {increment} from '../achievements';
import db from '../lib/firestore';
import type {SlackInterface} from '../lib/slack';
import {getReactions} from '../lib/slackUtils';
import State from '../lib/state';

const isQualifiableMessage = (message: GenericMessageEvent) => {
	if (message?.attachments?.length > 0) {
		return false;
	}
	if (message?.files?.length > 0) {
		return false;
	}
	if (message?.subtype === 'bot_message' && message?.blocks?.length > 1) {
		return false;
	}

	const text = message.text || '';
	const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
	if (lines.length !== 1) {
		return false;
	}

	const [line] = lines;
	const lineLength = line.length;
	return lineLength >= 1 && lineLength <= 60;
};

interface StateObj {
	processedMessages: string[],
}

const TopicMessages = db.collection('topic_messages');

export const addLike = async (user: string, ts: string) => {
	await db.runTransaction(async (transaction) => {
		const message = await transaction.get(TopicMessages.doc(ts));
		if (!message.exists) {
			return;
		}

		const likes = message.get('likes') ?? [];
		if (!likes.includes(user)) {
			likes.push(user);
		}

		transaction.update(TopicMessages.doc(ts), {likes});
	});
};

export const removeLike = async (user: string, ts: string) => {
	await db.runTransaction(async (transaction) => {
		const message = await transaction.get(TopicMessages.doc(ts));
		if (!message.exists) {
			return;
		}

		const likes = message.get('likes') ?? [];
		if (likes.includes(user)) {
			likes.splice(likes.indexOf(user), 1);
		}

		transaction.update(TopicMessages.doc(ts), {likes});
	});
};

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
		const [headline, ...currentTopics] = currentTopicText.split(/[／｜]/).map((topic) => topic.trim());
		let topicText = '';
		const topics = [headline];
		for (const topic of [newTopic, ...currentTopics]) {
			topics.push(topic);
			const newTopicText = topics.join('｜');
			if (newTopicText.length > 250) {
				break;
			}
			topicText = newTopicText;
		}

		await slack.conversations.setTopic({
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
		const koresukiCount = reactions.koresuki?.length || 0;
		if (koresukiCount < 5) {
			return;
		}

		const res = await slack.conversations.history({
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

		// スレッド内の発言はconversations.historyで取得できないため正しいメッセージが取得できない場合がある
		if (event.item.ts !== message?.ts) {
			return;
		}

		processedMessages.add(event.item.ts);
		state.processedMessages.push(event.item.ts);
		if (!isQualifiableMessage(message)) {
			return;
		}

		await TopicMessages.doc(message.ts).set({message, likes: []});

		increment(message.user, 'topic-adopted');
		await updateTopic(message.text.trim());
	});
};
