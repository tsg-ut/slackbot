const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const {stripIndent} = require('common-tags');
const zlib = require('zlib');
const {promisify} = require('util');

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	rtm.on(MESSAGE, async (message) => {
		if (!message.text) {
			return;
		}

		const {text} = message;
		let matches = null;

		if ((matches = text.match(/https:\/\/tio.run\/##([\w@/]+)/))) {
			const [, data] = matches;
			const buffer = Buffer.from(data.replace(/@/g, '+'), 'base64');
			const rawData = await promisify(zlib.inflateRaw)(buffer);

			const segments = [];
			let pointer = -Infinity;
			for (const [index, byte] of rawData.entries()) {
				if (byte === 0xff) {
					segments.push(rawData.slice(pointer + 1, index));
					pointer = index;
				}
			}

			const [language, , codeData] = segments;
			const code = codeData.toString();

			const formattedText = (code.includes('\n') || code.includes('`')) ? `\`\`\`\n${code.toString()}\n\`\`\`` : `\n\`${code.toString()}\``;

			await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, stripIndent`
				*${language.toString()}, ${codeData.length} bytes* ${formattedText}
			`, {
				username: 'tiobot',
				icon_url: 'https://i.imgur.com/2mB02ZI.png',
			});
		}
	});
};
