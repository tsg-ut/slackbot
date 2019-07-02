import download from 'download';

import {RTMClient, WebClient} from '@slack/client';

const bracketMapPromise = (async () => {
	const bracketData = await download('https://www.unicode.org/Public/UCD/latest/ucd/BidiBrackets.txt');
	const bracketEntries = bracketData.toString().split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
	const bracketMap = new Map(bracketEntries.map((line) => {
		const [from, to, type] = line.split(/[;#]/);
		return [String.fromCodePoint(parseInt(from.trim(), 16)), {
			pair: String.fromCodePoint(parseInt(to.trim(), 16)),
			type: type.trim() === 'c' ? 'close' : 'open',
		}];
	}));

	return bracketMap;
})();

const matchBrackets = async (text: string) => {
	const bracketMap = await bracketMapPromise;
	const stack: string[] = [];
	for (const char of text) {
		if (!bracketMap.has(char)) {
			continue;
		}

		const {pair, type} = bracketMap.get(char);
		if (type === 'open') {
			stack.push(pair);
		} else if (type === 'close') {
			if (stack.length === 0) {
				continue;
			}
			stack.pop();
		}
	}
	return stack.concat().reverse().join('');
};


interface SlackInterface {
	rtmClient: RTMClient;
	webClient: WebClient;
}

export default ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message: any) => {
		// if (message.channel !== process.env.CHANNEL_SANDBOX) {
		// if (!message.channel.startsWith('D')) {
		if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'bracket-matcher') {
			return;
		}

		const postMessage = (text: string) => slack.chat.postMessage({
			channel: message.channel,
			text,
			username: 'bracket-matcher',
			icon_emoji: ':ti-n:',
		});

		const bracket = await matchBrackets(message.text);
		if (!bracket) {
			return;
		}

		postMessage(bracket);
	});
};
