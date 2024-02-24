import logger from '../lib/logger';
import isValidUTF8 from 'utf-8-validate';
import encodingJapanese from 'encoding-japanese';
import libmime from 'libmime';
import plugin from 'fastify-plugin';
import type {FastifyPluginCallback} from 'fastify';
import type {SlackInterface} from '../lib/slack.js';

const log = logger.child({bot: 'mail-hook'});

const sanitizeCode = (input: string) => ["`", input.replace(/`/g, "'"), "`"].join('');
const sanitizePreformatted = (input: string) => ["```", input.replace(/`/g, "'"), "```"].join("\n");

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

export const server = ({webClient: slack}: SlackInterface) => {
	const callback: FastifyPluginCallback = async (fastify, opts, next) => {
		fastify.post<SmtpHookEndpoint>('/api/smtp-hook', async (req, res) => {
			try {
				// internal hook
				if (req.raw.socket.remoteAddress !== '127.0.0.1') {
					return res.code(403);
				}

				const {addresses, subject, body} = req.body;

				const decodedSubject = decodeMailSubject(subject);
				const text = decodeMailBody(body.text);

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_PRLOG,
					username: 'Email Notifier',
					icon_emoji: ':email:',
					text: [
						`MAILFROM: ${sanitizeCode(addresses.mailfrom)}`,
						`TO: ${sanitizeCode(addresses.to)}`,
						...(addresses.cc ? [`CC: ${sanitizeCode(addresses.cc)}`] : []),
						`FROM: ${sanitizeCode(addresses.from)}`,
						`SUBJECT: ${sanitizeCode(decodedSubject)}`,
					].join("\n"),
					attachments: [{
						text,
					}],
				});

				return res.send('ok');
			} catch (e) {
				log.error('error', {error: e});

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

	return plugin(callback);
};
