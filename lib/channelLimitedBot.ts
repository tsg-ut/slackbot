import type {SlackInterface} from './slack';
import {extractMessage, isGenericMessage} from './slackUtils';
import type {GenericMessageEvent, WebClient} from '@slack/web-api';
import type {MessageEvent} from '@slack/bolt';
import logger from './logger';

export class ChannelLimitedBot {
	protected slack: WebClient;
	protected eventClient: SlackInterface['eventClient'];
	protected wakeWordRegex = /.*/;
	protected allowedChannels: string[] = [process.env.CHANNEL_GAMES!];

	protected log = logger.child({bot: this.constructor.name});

	constructor(
		slackClients: SlackInterface,
	) {
		this.slack = slackClients.webClient;
		this.eventClient = slackClients.eventClient;

		this.log.info(`Initialized ${this.constructor.name}`);
		this.log.info(`Allowed channels: ${this.allowedChannels.join(', ')}`);

		this.eventClient.on('message', this.onMessageEvent.bind(this));
	}

	protected async onMessageEvent(event: MessageEvent) {
		const message = extractMessage(event);

		if (
			message === null ||
			!message.text ||
			!message.user ||
			message.bot_id !== undefined ||
			!isGenericMessage(message)
		) {
			return;
		}

		if (this.wakeWordRegex.test(message.text)) {
			const channel = this.allowedChannels.includes(message.channel) ? message.channel : this.allowedChannels[0];

			const responseTs = await this.onWakeWord(message, channel);

			if (!this.allowedChannels.includes(message.channel)) {
				if (responseTs === null) {
					await this.slack.chat.postEphemeral({
						channel: message.channel,
						user: message.user,
						text: 'このチャンネルではBOTを実行できません。',
					});
				} else {
					const responseUrl = await this.slack.chat.getPermalink({
						channel,
						message_ts: responseTs,
					});
					await this.slack.chat.postEphemeral({
						channel: message.channel,
						user: message.user,
						text: `このチャンネルではBOTを実行できません。代わりに<${responseUrl.permalink}|こちら>で実行しました。`,
					});
				}

				await this.deleteMessage(event);
			}
		}
	}

	protected deleteMessage(event: MessageEvent) {
		return this.slack.chat.delete({
			channel: event.channel,
			ts: event.ts!,
		});
	}

	protected async onWakeWord(event: GenericMessageEvent, targetChannel: string): Promise<string | null> {
		// Should be overriden
		return null;
	}
}