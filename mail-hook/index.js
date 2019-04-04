const sanitizeCode = (input) => ["`", input.replace("`", "'"), "`"].join('');
const sanitizePreformatted = (input) => ["```", input.replace("`", "'"), "```"].join("\n");

module.exports.server = ({webClient: slack}) => async (fastify) => {
    fastify.post('/api/smtp-hook', async (req, res) => {
        try {
            // internal hook
            if (req.raw.ip !== '127.0.0.1') return res.code(403);

            const {addresses, subject, body} = req.body;

            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'Email Notifier',
                icon_emoji: ':email:',
                text: [
                    `TO: ${sanitizeCode(addresses.to)}`,
                    ...(addresses.cc ? [`CC: ${sanitizeCode(addresses.cc)}`] : []),
                    `FROM: ${sanitizeCode(addresses.from)}`,
                    `SUBJECT: ${sanitizeCode(subject)}`,
                    'BODY:',
                    sanitizePreformatted(body.text),
                ].join("\n"),
            });

            return res.send('ok');
        } catch (e) {
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                username: 'Email Notifier',
                icon_emoji: ':email:',
                text: 'sorry :cry:\n an error occured while processing email.',
            });
            return res.code(500);
        }
    });
};
