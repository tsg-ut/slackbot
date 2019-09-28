const logger = require('../lib/logger.js');
const isValidUTF8 = require('utf-8-validate');

const sanitizeCode = (input) => ["`", input.replace(/`/g, "'"), "`"].join('');
const sanitizePreformatted = (input) => ["```", input.replace(/`/g, "'"), "```"].join("\n");

module.exports.server = ({webClient: slack}) => async (fastify) => {
    fastify.post('/api/smtp-hook', async (req, res) => {
        try {
            // internal hook
            if (req.raw.ip !== '127.0.0.1') return res.code(403);

            const {addresses, subject, body} = req.body;

            let text = body.text;
            {
                const buf = Buffer.from(text, 'base64');
                if (isValidUTF8(buf)) {
                    text = buf.toString();
                }
            }

            await slack.chat.postMessage({
                channel: process.env.CHANNEL_PRLOG,
                username: 'Email Notifier',
                icon_emoji: ':email:',
                text: [
                    `MAILFROM: ${sanitizeCode(addresses.mailfrom)}`,
                    `TO: ${sanitizeCode(addresses.to)}`,
                    ...(addresses.cc ? [`CC: ${sanitizeCode(addresses.cc)}`] : []),
                    `FROM: ${sanitizeCode(addresses.from)}`,
                    `SUBJECT: ${sanitizeCode(subject)}`,
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

            return res.code(500);
        }
    });
};
