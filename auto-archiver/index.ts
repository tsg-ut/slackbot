import {BlockButtonAction, MessageEvent} from '@slack/bolt';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import schedule from 'node-schedule';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {extractMessage} from '../lib/slackUtils';
import State from '../lib/state';

const mutex = new Mutex();

const ARCHIVE_SNOOZE_DAYS = 30;
const ARCHIVE_SNOOZE_DURATION = 1000 * 60 * 60 * 24 * ARCHIVE_SNOOZE_DAYS;
const ARCHIVE_LIMIT_DAYS = 90;
const ARCHIVE_LIMIT_DURATION = 1000 * 60 * 60 * 24 * ARCHIVE_LIMIT_DAYS;
const ARCHIVE_WAIT_HOURS = 24;
const ARCHIVE_WAIT_DURATION = 1000 * 60 * 60 * ARCHIVE_WAIT_HOURS;
const ARCHIVE_PROPOSAL_MESSAGE = stripIndent`
	<!channel> このチャンネルには${ARCHIVE_LIMIT_DAYS}日以上BOT以外のメッセージが投稿されていません。
	引き続きこのチャンネルを使用しますか?
`;
const ARCHIVE_NOTE_MESSAGE = stripIndent`
	* 「使用する」を押した場合、${ARCHIVE_SNOOZE_DAYS}日間は再度このメッセージが表示されません。
	* 「使用しない」を押す、もしくは24時間以内に応答がない場合、チャンネルはアーカイブされます。
	* アーカイブされたチャンネルは、必要に応じて復元できます。
	* BOTの投稿がメインのチャンネルの場合、チャンネル名の先頭に「_」をつけることでアーカイブを回避できます。
`;
const ARCHIVE_BOT_LOCK_TIME = new Date('2024-06-20T00:00:00Z').getTime();

const log = logger.child({bot: 'auto-archiver'});

export interface ChannelsStateObj {
	[channelId: string]: string,
}

export interface StateObj {
	snoozes: {
		channelId: string,
		expire: number,
	}[],
	notices: {
		channelId: string,
		ts: string,
	}[],
}

export default async ({eventClient, webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	const channels = await State.init<ChannelsStateObj>('auto-archiver_channels', {});
	const state = await State.init<StateObj>('auto-archiver_state', {
		snoozes: [],
		notices: [],
	});

	eventClient.on('message', (messageEvent: MessageEvent) => {
		const message = extractMessage(messageEvent);

		if (
			message === null ||
			!message.text ||
			!message.user ||
			message.bot_id !== undefined ||
			message.subtype !== undefined
		) {
			return;
		}

		const lastMessageTs = channels[message.channel] ?? '0';
		if (parseFloat(message.ts) > parseFloat(lastMessageTs)) {
			channels[message.channel] = message.ts;
		}
	});

	const postArchiveProposal = async (now: Date) => {
		if (now.getTime() < ARCHIVE_BOT_LOCK_TIME) {
			return;
		}

		for (const notice of state.notices) {
			const noticeTs = parseFloat(notice.ts) * 1000;
			const expire = noticeTs + ARCHIVE_WAIT_DURATION;
			if (now.getTime() >= expire) {
				await slack.chat.postMessage({
					channel: notice.channelId,
					text: '24時間以内に応答がなかったため、チャンネルをアーカイブしました。',
				});
				await slack.conversations.archive({
					channel: notice.channelId,
					token: process.env.HAKATASHI_TOKEN,
				});
				state.notices = state.notices.filter((n) => n.ts !== notice.ts);
			}
		}

		const channelsResult = await slack.conversations.list({
			types: 'public_channel',
		});

		for (const channel of channelsResult.channels) {
			if (channel.is_archived || channel.is_general || channel.name.startsWith('_')) {
				continue;
			}

			if (state.snoozes.some((snooze) => (
				snooze.channelId === channel.id &&
				snooze.expire > now.getTime()
			))) {
				continue;
			}

			const lastMessageTs = channels[channel.id] ?? '0';
			const lastMessageDate = new Date(parseFloat(lastMessageTs) * 1000);
			const diff = now.getTime() - lastMessageDate.getTime();

			if (diff > ARCHIVE_LIMIT_DURATION) {
				const message = await slack.chat.postMessage({
					channel: channel.id,
					text: ARCHIVE_PROPOSAL_MESSAGE,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: ARCHIVE_PROPOSAL_MESSAGE,
							},
						},
						{
							type: 'actions',
							block_id: 'archive_proposal_actions',
							elements: [
								{
									type: 'button',
									text: {
										type: 'plain_text',
										text: '使用する',
									},
									value: 'continue',
								},
								{
									type: 'button',
									text: {
										type: 'plain_text',
										text: '使用しない',
									},
									value: 'stop',
								},
							],
						},
						{
							type: 'context',
							elements: [
								{
									type: 'mrkdwn',
									text: ARCHIVE_NOTE_MESSAGE,
								},
							],
						},
					],
				});

				state.notices.push({
					channelId: channel.id,
					ts: message.ts,
				});
			}
		}
	};

	slackInteractions.action({
		type: 'button',
		blockId: 'archive_proposal_actions',
	}, async (payload: BlockButtonAction) => {
		const channelId = payload.channel.id;

		await slack.chat.update({
			channel: channelId,
			ts: payload.message.ts,
			text: ARCHIVE_PROPOSAL_MESSAGE,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: ARCHIVE_PROPOSAL_MESSAGE,
					},
				},
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `<@${payload.user.id}>の回答: ＊${payload.actions[0].text.text}＊`,
					},
				},
				{
					type: 'context',
					elements: [
						{
							type: 'mrkdwn',
							text: ARCHIVE_NOTE_MESSAGE,
						},
					],
				},
			],
		});

		state.notices = state.notices.filter((n) => n.ts !== payload.message.ts);

		if (payload.actions[0].value === 'continue') {
			log.info(`snoozing channel ${channelId}`);
			const now = new Date();
			const expire = now.getTime() + ARCHIVE_SNOOZE_DURATION;

			state.snoozes.push({
				channelId,
				expire,
			});
		} else {
			log.info(`archiving channel ${channelId}`);
			await slack.conversations.archive({
				channel: channelId,
				token: process.env.HAKATASHI_TOKEN,
			});
		}
	});

	schedule.scheduleJob('0 9 * * *', (now) => (
		mutex.runExclusive(() => (
			postArchiveProposal(now)
		))
	));
};

