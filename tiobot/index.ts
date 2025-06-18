import {inflateRaw} from 'zlib';
import {stripIndent} from 'common-tags';
import type {SlackInterface} from '../lib/slack';

export default ({eventClient, webClient: slack}: SlackInterface) => {
	eventClient.on('message', async (message) => {
		if (!message.text) {
			return;
		}

		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		const {text} = message;
		let matches: string[] = null;

		if ((matches = text.match(/https:\/\/tio.run\/##([\w@/]+)/))) {
			const [, data] = matches;
			const buffer = Buffer.from(data.replace(/@/g, '+'), 'base64');
			const rawData = await new Promise<Buffer>((resolve, reject) => {
				inflateRaw(buffer as any, (error, result) => {
					if (error) {
						reject(error);
					} else {
						resolve(result);
					}
				});
			});

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

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					*${language.toString()}, ${codeData.length} bytes* ${formattedText}
				`,
				username: 'tiobot',
				icon_url: 'https://i.imgur.com/2mB02ZI.png',
			});
		}
	});
};
