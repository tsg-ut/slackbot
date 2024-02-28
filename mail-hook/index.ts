import {randomUUID} from 'crypto';
import {readFile} from 'fs/promises';
import path from 'path';
import type {BlockButtonAction} from '@slack/bolt';
import {ChatPostMessageResponse} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import encodingJapanese from 'encoding-japanese';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
import yaml from 'js-yaml';
import libmime from 'libmime';
import {mapValues} from 'lodash';
import type OpenAI from 'openai';
import isValidUTF8 from 'utf-8-validate';
import dayjs from '../lib/dayjs';
import logger from '../lib/logger';
import mailgun from '../lib/mailgun';
import openai from '../lib/openai';
import type {SlackInterface} from '../lib/slack.js';
import State from '../lib/state';
import editAndSendMailDialog from './views/editAndSendMailDialog';
import replyConfigDialog from './views/replyConfigDialog';

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

const configLabels: {[label: string]: string} = {
	name: '代表者の氏名',
	email: 'メールアドレス',
	website: 'ウェブサイト',
};

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

export const generateReplyMailBody = (mail: Mail, reply: string) => {
	const localizedDate = dayjs(mail.date).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH:mm:ss');

	return [
		reply,
		'',
		`${localizedDate} ${mail.addresses.from}:`,
		...mail.body.text.split('\n').map((line) => `> ${line}`),
	].join('\n');
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

export interface Mail {
	id: string,
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
	replyCandidates: {
		id: string,
		user: string,
		content: string,
		isSent: boolean,
		sentContent: string | null,
		sentBy: string | null,
		sentAt: number | null,
	}[],
}

interface MailsStateObj {
	[id: string]: Mail,
}

interface MailConfigsStateObj {
	[id: string]: string | null,
}

export const server = async ({webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	const state = await State.init<MailsStateObj>('mail-hook-mails', {});
	const configState = await State.init<MailConfigsStateObj>(
		'mail-hook-mail-configs',
		mapValues(configLabels, () => null),
	);

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
							type: 'section',
							text: {
								type: 'plain_text',
								text: 'クイック返信 (ChatGPT使用)',
							},
							accessory: {
								type: 'button',
								text: {
									type: 'plain_text',
									text: 'メール設定',
									emoji: true,
								},
								action_id: 'mail-hook-reply-config',
							},
						},
						{
							type: 'actions',
							block_id: 'mail-hook-reply',
							elements:
								prompts.map(({id: promptId, label}) => ({
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
					id,
					addresses,
					subject: decodedSubject,
					body: {
						text,
					},
					date: new Date(timestamp).toISOString(),
					message,
					replyCandidates: [],
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

	// 「メール設定」ボタン
	slackInteractions.action({
		type: 'button',
		actionId: 'mail-hook-reply-config',
	}, (payload: BlockButtonAction) => {
		mutex.runExclusive(async () => {
			await slack.views.open({
				trigger_id: payload.trigger_id,
				view: replyConfigDialog(Object.entries(configState).map(([id, value]) => ({
					label: configLabels[id],
					id,
					value,
				}))),
			});
		});
	});

	// 「メール設定」ダイアログ送信
	slackInteractions.viewSubmission('mail_hook_reply_config_dialog', (payload) => {
		mutex.runExclusive(() => {
			const {view} = payload;
			const values = view.state.values as {[id: string]: {[id: string]: {type: 'plain_text_input', value: string}}};
			for (const value of Object.values(values)) {
				for (const [key, input] of Object.entries(value)) {
					configState[key] = input.value;
				}
			}
		});
	});

	// 返信ボタン
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

			for (const [key, value] of Object.entries(configState)) {
				if (!value) {
					await slack.chat.postEphemeral({
						channel: mail.message.channel,
						user: payload.user.id,
						text: `:warning: ${configLabels[key]} が設定されていません`,
					});
					return;
				}
			}

			await slack.chat.postEphemeral({
				channel: mail.message.channel,
				user: payload.user.id,
				text: '返信を生成中... :email:',
			});

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

			let result = completion.choices?.[0]?.message?.content;
			const replyId = randomUUID();

			for (const [key, value] of Object.entries(configState)) {
				if (value) {
					result = result?.replaceAll(`[${configLabels[key]}]`, value);
				}
			}

			if (!result) {
				log.error('result not found');
				return;
			}

			mail.replyCandidates.push({
				id: replyId,
				user: payload.user.id,
				content: result,
				isSent: false,
				sentContent: null,
				sentBy: null,
				sentAt: null,
			});

			log.info('sending reply to Slack...');

			await slack.chat.postMessage({
				channel: mail.message.channel,
				username: 'ChatGPT',
				icon_emoji: ':chatgpt:',
				text: result,
				thread_ts: mail.message.ts,
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `:chatgpt: 返信を生成したよ～ (Generated by <@${payload.user.id}>)`,
						},
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `>>>${result}`,
						},
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: ':chatgpt: 再生成する場合は、もう一度ボタンを押してね',
						},
					},
					{
						type: 'actions',
						block_id: 'mail-hook-edit-mail',
						elements: [
							{
								type: 'button',
								text: {
									type: 'plain_text',
									text: '内容を編集してメールを送信する (管理者のみ)',
									emoji: true,
								},
								style: 'primary',
								action_id: 'mail-hook-edit-and-send-mail',
								value: JSON.stringify({replyId, mailId}),
							},
						],
					},
				],
			});
		});
	});

	// 「編集して送信」ボタン
	slackInteractions.action({
		type: 'button',
		actionId: 'mail-hook-edit-and-send-mail',
	}, (payload: BlockButtonAction) => {
		mutex.runExclusive(async () => {
			const action = payload.actions?.[0];
			if (!action) {
				log.error('action not found');
				return;
			}

			const user = await slack.users.info({
				user: payload.user.id,
			});

			if (!user.user?.is_admin && !user.user?.is_owner && !user.user?.is_primary_owner) {
				await slack.chat.postEphemeral({
					channel: payload.channel.id,
					user: payload.user.id,
					text: 'この操作は管理者のみが実行できます',
				});
				return;
			}

			const {replyId, mailId} = JSON.parse(action.value);
			const mail = state[mailId];
			if (!mail) {
				log.error('mail not found');
				return;
			}

			if (mail.replyCandidates.some(({isSent}) => isSent)) {
				await slack.chat.postEphemeral({
					channel: mail.message.channel,
					user: payload.user.id,
					text: 'このメールは既に返信が送信されています',
				});
				return;
			}

			const replyCandidate = mail.replyCandidates.find(({id}) => id === replyId);
			if (!replyCandidate) {
				log.error('replyCandidate not found');
				return;
			}

			await slack.views.open({
				trigger_id: payload.trigger_id,
				view: editAndSendMailDialog(replyId, mail, replyCandidate.content),
			});
		});
	});

	// 「メール送信」ダイアログ送信
	slackInteractions.viewSubmission('mail_hook_edit_and_send_mail_dialog', (payload) => {
		mutex.runExclusive(async () => {
			const user = await slack.users.info({
				user: payload.user.id,
			});

			if (!user.user?.is_admin && !user.user?.is_owner && !user.user?.is_primary_owner) {
				await slack.chat.postEphemeral({
					channel: payload.channel.id,
					user: payload.user.id,
					text: 'この操作は管理者のみが実行できます',
				});
				return;
			}

			await slack.chat.postEphemeral({
				channel: process.env.CHANNEL_PRLOG,
				user: payload.user.id,
				text: 'メールを送信中... :email:',
			});

			log.info('sending mail...');

			const {view} = payload;
			const values = view.state.values as {[id: string]: {[id: string]: {type: 'plain_text_input', value: string}}};
			const {mailId, replyId} = JSON.parse(view.private_metadata);
			const mail = state[mailId];
			if (!mail) {
				log.error('mail not found');
				return;
			}

			// eslint-disable-next-line prefer-destructuring
			const {body} = Object.values(values)[0];
			const replyCandidate = mail.replyCandidates.find(({id}) => id === replyId);
			if (!replyCandidate) {
				log.error('replyCandidate not found');
				return;
			}

			const replyContent = generateReplyMailBody(mail, body.value);
			// eslint-disable-next-line array-plural/array-plural
			const cc = [process.env.MAIL_HOOK_REPLY_FROM];
			if (mail.addresses.cc) {
				cc.push(mail.addresses.cc);
			}

			const res = await mailgun.messages.create(process.env.MAILGUN_DOMAIN, {
				from: process.env.MAIL_HOOK_REPLY_FROM,
				to: mail.addresses.from,
				cc,
				'h:Reply-To': process.env.MAIL_HOOK_REPLY_FROM,
				subject: `Re: ${mail.subject}`,
				text: replyContent,
			});

			if (res.status !== 200) {
				await slack.chat.postEphemeral({
					channel: mail.message.channel,
					user: payload.user.id,
					text: 'メールの送信に失敗しました',
				});
				return;
			}

			Object.assign(replyCandidate, {
				isSent: true,
				sentContent: body.value,
				sentBy: payload.user.id,
				sentAt: Date.now(),
			});

			await slack.chat.postMessage({
				channel: mail.message.channel,
				username: 'ChatGPT',
				icon_emoji: ':chatgpt:',
				thread_ts: mail.message.ts,
				reply_broadcast: true,
				text: 'メールを送信しました',
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `:email: メールを送信しました (Sent by <@${payload.user.id}>)`,
						},
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: stripIndent`
								FROM: \`${process.env.MAIL_HOOK_REPLY_FROM}\`
								REPLY-TO: \`${process.env.MAIL_HOOK_REPLY_FROM}\`
								TO: \`${mail.addresses.from}\`
								CC: \`${mail.addresses.cc}\`
								SUBJECT: \`Re: ${mail.subject}\`
							`,
						},
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `>>>${replyContent}`,
						},
					},
				],
			});
		});
	});

	return plugin(callback);
};
