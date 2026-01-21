import type {SlackInterface} from './slack';
import {extractMessage, isGenericMessage} from './slackUtils';
import type {ChatPostMessageArguments, GenericMessageEvent, WebClient} from '@slack/web-api';
import type {MessageEvent} from '@slack/bolt';
import logger from './logger';
import {Deferred} from './utils';

export class ChannelLimitedBot {
	protected readonly slack: WebClient;
	protected readonly eventClient: SlackInterface['eventClient'];
	protected readonly messageClient: SlackInterface['messageClient'];

	protected readonly log = logger.child({bot: this.constructor.name});

	protected readonly wakeWordRegex = /.*/;
	protected readonly allowedChannels: string[] = [process.env.CHANNEL_GAMES!];
	protected readonly username: string = 'slackbot';
	protected readonly iconEmoji: string = ':robot_face:';
	protected readonly progressMessageChannel: string | undefined = process.env.CHANNEL_SANDBOX;
	protected readonly progressMessages: Map<string, Deferred<string | null>> = new Map(); // gameMessageTs -> Deferred<progressMessageTs>

	constructor(
		protected readonly slackClients: SlackInterface,
	) {
		this.slack = slackClients.webClient;
		this.eventClient = slackClients.eventClient;
		this.messageClient = slackClients.messageClient;

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

		if (!this.wakeWordRegex.test(message.text)) {
			return;
		}

		const channel = this.allowedChannels.includes(message.channel) ? message.channel : this.allowedChannels[0];

		const responseTs = await this.onWakeWord(message, channel);
		const progressMessageDeferred = new Deferred<string | null>();
		if (responseTs !== null) {
			this.progressMessages.set(responseTs, progressMessageDeferred);
		}

		const isAllowedChannel = this.allowedChannels.includes(message.channel);

		if (responseTs === null) {
			if (!isAllowedChannel) {
				await this.slack.chat.postEphemeral({
					channel: message.channel,
					user: message.user,
					text: 'このチャンネルではBOTを実行できません。',
				});
			}
		} else {
			const {permalink: responseUrl} = await this.slack.chat.getPermalink({
				channel,
				message_ts: responseTs,
			});

			this.log.debug(`Response permalink: ${responseUrl}`);

			if (!responseUrl) {
				this.log.error('Failed to get permalink for response message');
				progressMessageDeferred.reject(new Error('Failed to get permalink for response message'));
			} else {
				if (!isAllowedChannel) {
					await this.slack.chat.postEphemeral({
						channel: message.channel,
						user: message.user,
						text: `このチャンネルではBOTを実行できません。代わりに<${responseUrl}|こちら>で実行しました。`,
					});
				}

				const progressMessageTs = await this.postProgressMessage(channel, responseTs, responseUrl);
				if (progressMessageTs) {
					progressMessageDeferred.resolve(progressMessageTs);
				} else {
					progressMessageDeferred.resolve(null);
				}
			}
		}

		if (!isAllowedChannel) {
			await this.slack.chat.delete({
				token: process.env.HAKATASHI_TOKEN,
				channel: event.channel,
				ts: event.ts!,
			});
		}
	}

	protected async postProgressMessage(
		gameMessageChannel: string,
		gameMessageTs: string,
		gameMessageUrl?: string,
	): Promise<string | undefined> {
		if (
			this.progressMessageChannel === undefined ||
			this.progressMessageChannel === gameMessageChannel
		) {
			return undefined;
		}

		const gameMessageLink = gameMessageUrl ?? (await this.slack.chat.getPermalink({
			channel: gameMessageChannel,
			message_ts: gameMessageTs,
		})).permalink;

		if (gameMessageLink === undefined) {
			this.log.error('Failed to get permalink for game message');
			return undefined;
		}

		const progressMessage = await this.postMessage({
			channel: this.progressMessageChannel,
			text: `<${gameMessageLink}|進行中のゲーム>があります！`,
			unfurl_links: false,
			unfurl_media: false,
		});

		return progressMessage.ts;
	}

	protected postMessage(message: ChatPostMessageArguments) {
		return this.slack.chat.postMessage({
			username: this.username,
			icon_emoji: this.iconEmoji,
			...message,
		} as ChatPostMessageArguments);
	}

	protected async deleteProgressMessage(gameMessageTs: string) {
		if (this.progressMessageChannel === undefined) {
			return;
		}

		const progressMessageDeferred = this.progressMessages.get(gameMessageTs);
		if (progressMessageDeferred === undefined) {
			return;
		}

		this.progressMessages.delete(gameMessageTs);
		const progressMessageTs = await progressMessageDeferred.promise;

		if (progressMessageTs !== null) {
			await this.slack.chat.delete({
				channel: this.progressMessageChannel,
				ts: progressMessageTs,
			});
		}
	}

	protected async onWakeWord(event: GenericMessageEvent, targetChannel: string): Promise<string | null> {
		// Should be overridden
		return null;
	}
}