import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {
	kMackerelInviteStartBlockId,
	kMackerelInviteModalId,
	kMackerelEmailInputBlockId,
	kMackerelEmailInputActionId,
	botUsername,
	botIconEmoji,
} from './const';
import {InviteStartMessageView, Dialog} from './views/view';

// @ts-expect-error
import Mackerel from 'mackerel';

const log = logger.child({bot: 'mackerel'});

const botName = '@mackerel';
const emailRegExp = /^[a-z0-9._+-]+@[a-z0-9._+-]+$/i;

// TODO: これをテストに表現する
// `@mackerel invite` と来たら、ボタン付きメッセージをスレッド内に送る
// ボタンを押すとモーダルが現れ、メールアドレス入力欄がある
// メールアドレスを入力し、OKを押すと、MackerelのInvite APIが呼ばれる
// public messageで、招待が送られたことがSlack User ID付きで投稿される

export default ({eventClient, webClient: slack, messageClient}: SlackInterface) => {
	const mackerel = new Mackerel(process.env.MACKEREL_API_KEY);

	eventClient.on('message', async (message) => {
		if (message.text && !message.subtype && message.text.split(' ')[0] === botName) {
			const text = message.text.replace(botName, '').trim();

			if (text === 'invite') {
				await slack.chat.postMessage({
					...InviteStartMessageView({
						channelId: message.channel,
					}),
					thread_ts: message.ts,
				});
			} else {
				await slack.chat.postMessage({
					username: botUsername,
					icon_emoji: botIconEmoji,
					channel: message.channel,
					text: ':wakarazu:',
				});
			}
		}
	});

	messageClient.action({
		type: 'button',
		blockId: kMackerelInviteStartBlockId,
	}, async (payload, _respond) => {
		const {trigger_id, channel: {id: channel}} = payload;

		if (payload.actions[0].value === 'go') {
			await slack.views.open({
				trigger_id,
				view: {
					...Dialog(),
					private_metadata: JSON.stringify({channel}),
				},
			});
		}
	});

	messageClient.viewSubmission({
		externalId: kMackerelInviteModalId,
	}, (payload) => {
		const userId = payload?.user?.id;
		const email = payload?.view?.state?.values?.[kMackerelEmailInputBlockId]?.[kMackerelEmailInputActionId]?.value;
		const privateMetadata = JSON.parse(payload?.view?.private_metadata) ?? {};
		const {channel} = privateMetadata;

		if (!(email && emailRegExp.test(email))) {
			// TODO: このエラーをいい感じにモーダルに反映する
			//  ref: https://api.slack.com/surfaces/modals/using#displaying_errors
			throw Error('mackerel: invalid email');
		}

		(async () => {
			try {
				log.info(`mackerel.createInvitation: ${email} by ${userId}`);
				await slack.chat.postMessage({
					channel,
					username: botUsername,
					icon_emoji: botIconEmoji,
					text: `<@${userId}> has been invited to Mackerel! Check your inbox.`,
				});
				await mackerel.createInvitation({
					email,
					authority: 'collaborator',
				});
			} catch (error) {
				log.error(`mackerel.createInvitation(${userId}:${email}): ${error}`);
			}
		})();

		return {response_action: 'clear'};
	});
};
