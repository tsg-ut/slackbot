// @ts-ignore
import {stripIndent} from 'common-tags';
import * as zlib from 'zlib';
import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

const map = new Map();
const dream = new Map();

const lastMessage = new Map();

export default ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message) => {
		if (!message.text) {
			return;
		}

		const text = message.text.trim();

		const now = Date.now();

		let matched = false;

		if (text.includes('人生開始') || text.includes(':jinsei_kaishi:')) {
			matched = true;
			if (map.has(message.user)) {
				await slack.chat.postMessage({
					text: ':warning:すでに開始している人生を開始することはできません。',
					channel: process.env.CHANNEL_SANDBOX,
				});
			} else {
				map.set(message.user, now);
				await slack.chat.postMessage({
					text: stripIndent`
						<@${message.user}>さんの人生が開始しました。
					`,
					channel: process.env.CHANNEL_SANDBOX,
				});
			}
		}

		if (text.includes('人生終了') || text.includes(':jinsei_shuryo:') || text.includes('死にました')) {
			matched = true;
			if (!map.has(message.user)) {
				await slack.chat.postMessage({
					text: ':warning:開始していない人生を終了することはできません。',
					channel: process.env.CHANNEL_SANDBOX,
				});
			} else {
				const duration = now - map.get(message.user);
				await slack.chat.postMessage({
					text: stripIndent`
						<@${message.user}>さんの人生が終了しました。
						＊遺言＊ ${lastMessage.get(message.user)}
						＊享年＊ ${(duration / 1000 / 60 / 60 / 24 / 365.25).toFixed(8)}歳
					`,
					channel: process.env.CHANNEL_SANDBOX,
				});
				map.delete(message.user);
			}
		}

		const getDreamText = (depth: number) => {
			if (depth > 10) {
				return '夢の中の夢の中の夢の中の夢の中の夢の中の(中略)の中の夢の中の夢の中の夢の中の夢の中の夢';
			}
			if (depth > 0) {
				return Array(depth).fill('夢').join('の中の');
			}
			if (depth < -10) {
				return '現実の中の現実の中の現実の中の現実の中の現実の中の(中略)の中の現実の中の現実の中の現実の中の現実の中の現実';
			}
			return Array(-depth + 1).fill('現実').join('の中の');
		}

		let match = null;

		if (match = text.match(/(:zzz:|おやすみ|寝る)/g)) {
			matched = true;
			const depth = dream.get(message.user) || 0;
			dream.set(message.user, depth + match.length);
			await slack.chat.postMessage({
				text: stripIndent`
					<@${message.user}>さんが${getDreamText(depth)}で${match.length > 1 ? `${match.length}回` : ''}眠りにつきました。
					現在、${getDreamText(depth + match.length)}を見ています。
				`,
				channel: process.env.CHANNEL_SANDBOX,
			});
		}

		if (match = text.match(/(:ahokusa-top-right::ahokusa-bottom-left::heavy_exclamation_mark:|あさ|おはよう|起きた)/g)) {
			matched = true;
			const depth = dream.get(message.user) || 0;
			dream.set(message.user, depth - match.length);
			await slack.chat.postMessage({
				text: stripIndent`
					<@${message.user}>さんが${getDreamText(depth)}から${match.length > 1 ? `${match.length}回` : ''}覚めました
					現在、${getDreamText(depth - match.length)}にいます。
				`,
				channel: process.env.CHANNEL_SANDBOX,
			});
		}

		if (!matched) {
			lastMessage.set(message.user, text);
		}
	});
};
