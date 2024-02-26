import {randomUUID} from 'crypto';
import {readFile} from 'fs/promises';
import path from 'path';
import type {BlockButtonAction} from '@slack/bolt';
import {ChatPostMessageResponse, KnownBlock} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import encodingJapanese from 'encoding-japanese';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
import yaml from 'js-yaml';
import libmime from 'libmime';
import type OpenAI from 'openai';
import isValidUTF8 from 'utf-8-validate';
import logger from '../lib/logger';
import openai from '../lib/openai';
import type {SlackInterface} from '../lib/slack.js';
import State from '../lib/state';

const mutex = new Mutex();

const log = logger.child({bot: 'mail-hook'});

interface PromptConfig {
	id: string,
	label: string,
}

const prompts: PromptConfig[] = [
	{
		id: 'consideration',
		label: 'サークル内で検討し、後日返信いたします',
	},
	{
		id: 'rejection_by_out_of_curiocity',
		label: 'TSGの活動内容と異なるため、断らせていただきます',
	},
	{
		id: 'rejection_by_no_time',
		label: 'メンバーが忙しいため、断らせていただきます',
	},
];

const sanitizeCode = (input: string) => ['`', input.replace(/`/g, '\''), '`'].join('');

export const decodeMailSubject = (subject: string) => libmime.decodeWords(subject);

export const decodeMailBody = (text: string) => {
	let buf = Buffer.from(text, 'base64');
	if (!isValidUTF8(buf)) {
		buf = Buffer.from(text);
	}
	return encodingJapanese.convert(buf, {
		to: 'UNICODE',
		type: 'string',
	});
};

interface SmtpHookEndpoint {
	Body: {
		addresses: {
			mailfrom: string,
			to: string,
			cc?: string,
			from: string,
		},
		subject: string,
		body: {
			text: string,
		},
	},
}

interface MailsStateObj {
	[id: string]: {
		addresses: {
			mailfrom: string,
			to: string,
			cc?: string,
			from: string,
		},
		subject: string,
		body: {
			text: string,
		},
		date: string,
		message: ChatPostMessageResponse,
	}
}

export const server = async ({webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	const state = await State.init<MailsStateObj>('mail-hook-mails', {});

	const callback: FastifyPluginCallback = async (fastify, opts, next) => {
		fastify.post<SmtpHookEndpoint>('/api/smtp-hook', async (req, res) => {
			const timestamp = Date.now();
			const id = `mail-${timestamp}-${randomUUID()}`;

			try {
				// internal hook
				if (req.raw.socket.remoteAddress !== '127.0.0.1') {
					return res.code(403);
				}

				const {addresses, subject, body} = req.body;

				const decodedSubject = decodeMailSubject(subject);
				const text = decodeMailBody(body.text);

				const messageBody = [
					`MAILFROM: ${sanitizeCode(addresses.mailfrom)}`,
					`TO: ${sanitizeCode(addresses.to)}`,
					...(addresses.cc ? [`CC: ${sanitizeCode(addresses.cc)}`] : []),
					`FROM: ${sanitizeCode(addresses.from)}`,
					`SUBJECT: ${sanitizeCode(decodedSubject)}`,
				].join('\n');

				const message = await slack.chat.postMessage({
					channel: process.env.CHANNEL_PRLOG,
					username: 'Email Notifier',
					icon_emoji: ':email:',
					text: messageBody,
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: messageBody,
							},
						},
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: `>>>${text}`,
							},
						},
						{
							type: 'divider',
						},
						{
							type: 'context',
							elements: [
								{
									type: 'plain_text',
									text: 'クイック返信 (ChatGPT使用)',
								},
							],
						},
						{
							type: 'actions',
							block_id: 'mail-hook-reply',
							elements: prompts.map(({id: promptId, label}) => ({
								type: 'button',
								text: {
									type: 'plain_text',
									text: label,
									emoji: true,
								},
								action_id: promptId,
								style: 'primary',
								value: id,
							})),
						},
					],
				});

				state[id] = {
					addresses,
					subject: decodedSubject,
					body: {
						text,
					},
					date: new Date(timestamp).toISOString(),
					message,
				};

				return res.send('ok');
			} catch (error) {
				log.error('error', {error});

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_PRLOG,
					username: 'Email Notifier',
					icon_emoji: ':email:',
					text: 'sorry :cry:\n an error occured while processing email.',
				});

				return res.code(500).send('error');
			}
		});

		next();
	};

	slackInteractions.action({
		type: 'button',
		blockId: 'mail-hook-reply',
	}, (payload: BlockButtonAction) => {
		mutex.runExclusive(async () => {
			log.info('mail-hook-reply triggered');
			const action = payload.actions?.[0];
			if (!action) {
				log.error('action not found');
				return;
			}

			const actionId = action.action_id;
			const mailId = action.value;
			log.info(`actionId: ${actionId}, mailId: ${mailId}`);

			const mail = state[mailId];
			if (!mail) {
				log.error('mail not found');
				return;
			}

			const promptConfig = prompts.find(({id}) => id === actionId);
			if (!promptConfig) {
				log.error('prompt not found');
				return;
			}

			log.info('loading prompt...');
			const promptPath = path.resolve(__dirname, `prompts/${promptConfig.id}.yml`);
			const promptYaml = await readFile(promptPath, 'utf-8');
			const prompt = yaml.load(promptYaml) as OpenAI.Chat.ChatCompletionMessageParam[];
			for (const message of prompt) {
				if (typeof message.content === 'string') {
					message.content = message.content.replaceAll('{{BODY}}', mail.body.text);
				}
			}

			log.info('sending prompt to OpenAI...');
			const completion = await openai.chat.completions.create({
				model: 'gpt-3.5-turbo',
				max_tokens: 1024,
				messages: prompt,
			});

			const result = completion.choices?.[0]?.message?.content;
			log.info(result);
		});
	});

	return plugin(callback);
};
