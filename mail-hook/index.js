"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.generateReplyMailBody = exports.decodeMailBody = exports.decodeMailSubject = void 0;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const encoding_japanese_1 = __importDefault(require("encoding-japanese"));
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const libmime_1 = __importDefault(require("libmime"));
const lodash_1 = require("lodash");
const utf_8_validate_1 = __importDefault(require("utf-8-validate"));
const zod_1 = require("zod");
const dayjs_1 = __importDefault(require("../lib/dayjs"));
const logger_1 = __importDefault(require("../lib/logger"));
const mailgun_1 = __importDefault(require("../lib/mailgun"));
const openai_1 = __importDefault(require("../lib/openai"));
const state_1 = __importDefault(require("../lib/state"));
const editAndSendMailDialog_1 = __importDefault(require("./views/editAndSendMailDialog"));
const replyConfigDialog_1 = __importDefault(require("./views/replyConfigDialog"));
const mutex = new async_mutex_1.Mutex();
const log = logger_1.default.child({ bot: 'mail-hook' });
const DropdownSelectionSchema = zod_1.z.object({
    promptId: zod_1.z.string(),
    mailId: zod_1.z.string(),
});
const parseDropdownSelection = (value) => {
    try {
        const jsonValue = JSON.parse(value);
        return DropdownSelectionSchema.parse(jsonValue);
    }
    catch {
        return null;
    }
};
const prompts = [
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
const configLabels = {
    name: '代表者の氏名',
    email: 'メールアドレス',
    website: 'ウェブサイト',
};
const sanitizeCode = (input) => ['`', input.replace(/`/g, '\''), '`'].join('');
const decodeMailSubject = (subject) => libmime_1.default.decodeWords(subject);
exports.decodeMailSubject = decodeMailSubject;
const decodeMailBody = (text) => {
    let buf = Buffer.from(text, 'base64');
    if (!(0, utf_8_validate_1.default)(buf)) {
        buf = Buffer.from(text);
    }
    return encoding_japanese_1.default.convert(buf, {
        to: 'UNICODE',
        type: 'string',
    });
};
exports.decodeMailBody = decodeMailBody;
const generateReplyMailBody = (mail, reply) => {
    const localizedDate = (0, dayjs_1.default)(mail.date).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH:mm:ss');
    return [
        reply,
        '',
        `${localizedDate} ${mail.addresses.from}:`,
        ...mail.body.text.split('\n').map((line) => `> ${line}`),
    ].join('\n');
};
exports.generateReplyMailBody = generateReplyMailBody;
const server = async ({ webClient: slack, messageClient: slackInteractions }) => {
    const state = await state_1.default.init('mail-hook-mails', {});
    const configState = await state_1.default.init('mail-hook-mail-configs', (0, lodash_1.mapValues)(configLabels, () => null));
    const callback = (fastify, opts, next) => {
        fastify.post('/api/smtp-hook', async (req, res) => {
            const timestamp = Date.now();
            const id = `mail-${timestamp}-${(0, crypto_1.randomUUID)()}`;
            try {
                // internal hook
                if (req.raw.socket.remoteAddress !== '127.0.0.1') {
                    return res.code(403);
                }
                const { addresses, subject, body } = req.body;
                const decodedSubject = (0, exports.decodeMailSubject)(subject);
                const text = (0, exports.decodeMailBody)(body.text);
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
                                type: 'mrkdwn',
                                text: 'クイック返信 (ChatGPT使用)',
                            },
                            accessory: {
                                type: 'static_select',
                                placeholder: {
                                    type: 'plain_text',
                                    text: '返信パターンを選択...',
                                },
                                options: prompts.map(({ id: promptId, label }) => ({
                                    text: {
                                        type: 'plain_text',
                                        text: label,
                                    },
                                    value: JSON.stringify({ promptId, mailId: id }),
                                })),
                                action_id: 'mail-hook-reply-select',
                            },
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
            }
            catch (error) {
                log.error('error', { error });
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
    }, (payload) => {
        mutex.runExclusive(async () => {
            await slack.views.open({
                trigger_id: payload.trigger_id,
                view: (0, replyConfigDialog_1.default)(Object.entries(configState).map(([id, value]) => ({
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
            const { view } = payload;
            const values = view.state.values;
            for (const value of Object.values(values)) {
                for (const [key, input] of Object.entries(value)) {
                    configState[key] = input.value;
                }
            }
        });
    });
    // 返信ドロップダウン
    slackInteractions.action({
        type: 'static_select',
        actionId: 'mail-hook-reply-select',
    }, (payload) => {
        mutex.runExclusive(async () => {
            log.info('mail-hook-reply triggered');
            const selectedOption = payload.actions?.[0]?.selected_option;
            if (!selectedOption) {
                log.error('selected option not found');
                return;
            }
            const parsedValue = parseDropdownSelection(selectedOption.value);
            if (!parsedValue) {
                log.error('Invalid dropdown selection value', {
                    value: selectedOption.value,
                });
                return;
            }
            const { promptId, mailId } = parsedValue;
            log.info(`promptId: ${promptId}, mailId: ${mailId}`);
            const mail = state[mailId];
            if (!mail) {
                log.error('mail not found');
                return;
            }
            const promptConfig = prompts.find(({ id }) => id === promptId);
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
            const promptPath = path_1.default.resolve(__dirname, `prompts/${promptConfig.id}.yml`);
            const promptYaml = await (0, promises_1.readFile)(promptPath, 'utf-8');
            const prompt = js_yaml_1.default.load(promptYaml);
            for (const message of prompt) {
                if (typeof message.content === 'string') {
                    message.content = message.content.replaceAll('{{BODY}}', mail.body.text);
                }
            }
            log.info('sending prompt to OpenAI...');
            const completion = await openai_1.default.chat.completions.create({
                model: 'gpt-4o-mini',
                max_tokens: 1024,
                messages: prompt,
            });
            let result = completion.choices?.[0]?.message?.content;
            const replyId = (0, crypto_1.randomUUID)();
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
                                value: JSON.stringify({ replyId, mailId }),
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
    }, (payload) => {
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
            const { replyId, mailId } = JSON.parse(action.value);
            const mail = state[mailId];
            if (!mail) {
                log.error('mail not found');
                return;
            }
            if (mail.replyCandidates.some(({ isSent }) => isSent)) {
                await slack.chat.postEphemeral({
                    channel: mail.message.channel,
                    user: payload.user.id,
                    text: 'このメールは既に返信が送信されています',
                });
                return;
            }
            const replyCandidate = mail.replyCandidates.find(({ id }) => id === replyId);
            if (!replyCandidate) {
                log.error('replyCandidate not found');
                return;
            }
            await slack.views.open({
                trigger_id: payload.trigger_id,
                view: (0, editAndSendMailDialog_1.default)(replyId, mail, replyCandidate.content),
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
            const { view } = payload;
            const values = view.state.values;
            const { mailId, replyId } = JSON.parse(view.private_metadata);
            const mail = state[mailId];
            if (!mail) {
                log.error('mail not found');
                return;
            }
            // eslint-disable-next-line prefer-destructuring
            const { body } = Object.values(values)[0];
            const replyCandidate = mail.replyCandidates.find(({ id }) => id === replyId);
            if (!replyCandidate) {
                log.error('replyCandidate not found');
                return;
            }
            const replyContent = (0, exports.generateReplyMailBody)(mail, body.value);
            // eslint-disable-next-line array-plural/array-plural
            const cc = [process.env.MAIL_HOOK_REPLY_FROM];
            if (mail.addresses.cc) {
                cc.push(mail.addresses.cc);
            }
            const res = await mailgun_1.default.messages.create(process.env.MAILGUN_DOMAIN, {
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
                            text: (0, common_tags_1.stripIndent) `
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
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
