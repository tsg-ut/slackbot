const logger = require('../lib/logger.js');
const isValidUTF8 = require('utf-8-validate');
const encodingJapanese = require('encoding-japanese');
const libmime = require('libmime');

const sanitizeCode = (input) => ["`", input.replace(/`/g, "'"), "`"].join('');
const sanitizePreformatted = (input) => ["```", input.replace(/`/g, "'"), "```"].join("\n");

const decodeMailSubject = (subject) => libmime.decodeWords(subject);
module.exports.decodeMailSubject = decodeMailSubject;

const decodeMailBody = (text) => {
    let buf = Buffer.from(text, 'base64');
    if (!isValidUTF8(buf)) {
        buf = Buffer.from(text);
    }
    return encodingJapanese.convert(buf, {
        to: 'UNICODE',
        type: 'string',
    });
};
module.exports.decodeMailBody = decodeMailBody;

module.exports.server = ({webClient: slack}) => async (fastify) => {
    fastify.post('/api/smtp-hook', async (req, res) => {
        try {
            // internal hook
            if (req.raw.ip !== '127.0.0.1') return res.code(403);

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
            logger.error('mail-hook error:', e);

            await slack.chat.postMessage({
                channel: process.env.CHANNEL_PRLOG,
                username: 'Email Notifier',
                icon_emoji: ':email:',
                text: 'sorry :cry:\n an error occured while processing email.',
            });

            return res.code(500).send('error');
        }
    });
};
