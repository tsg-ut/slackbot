import type { WebAPICallResult } from '@slack/web-api';
import type { SlackInterface } from '../lib/slack';
import axios from 'axios';
import { stripIndent } from 'common-tags';
import sample from 'lodash/sample';
import { getPageTitle, getWordUrl } from '../tahoiya/lib';
import { getCandidateWords } from '../lib/candidateWords';
import { unlock, increment } from '../achievements';

interface ChatPostMessageResult extends WebAPICallResult {
	channel: string;
	ts: string;
	message: {
		text: string;
	}
}

type Candidate = [word: string, ruby: string, source: string, meaning: string, id: string];

type State = {
	type: 'Sleeping',
} | {
	type: 'Answering',
	title: string,
	answer: string,
	wordUrl: string,
	sorted: string,
	thread: string,
	timeoutId: NodeJS.Timeout,
};

const BOTNAME = `ソートなぞなぞ`;
const BOTICON = `:abc:`;

/**
 * 正解文字列に対するソート文字列を返す。
 */
const getSortedString = (answer: string): string => {
	return [...answer].sort((a, b) => {
		return a.codePointAt(0) - b.codePointAt(0);
	}).join('');
};

/**
 * 正解文字列に対する解答時間（秒）を返す。
 */
const calculateTimeout = (answer: string): number => {
	const length = [...answer].length;
	return Math.ceil((length * Math.log2(length) ** 2) / 10) * 10;
};

const getRandomTitle = async (): Promise<string> => {
	const { data } = await axios.get<any>(`https://ja.wikipedia.org/w/api.php`, {
		params: {
			action: 'query',
			format: 'json',
			list: 'random',
			rnnamespace: '0',
			rnlimit: '1',
		},
	});
	return data.query.random[0].title;
};

export default async ({ eventClient, webClient }: SlackInterface) => {
	let state: State = { type: 'Sleeping' };

	const candidateWords = await getCandidateWords({ min: 0, max: Infinity }) as Candidate[];

	const commands = process.env.NODE_ENV === 'production' ? {
		start: /^(?:ソート|そーと)なぞなぞ\s*(?:(?<specifiedLength>[1-9][0-9]?)(?:(?:文)?字)?)?$/,
		stop: /^(?:ソート|そーと)なぞなぞ\s*終了$/,
	} : {
		start: /^ア(?:ソート|そーと)なぞなぞ\s*(?:(?<specifiedLength>[1-9][0-9]?)(?:(?:文)?字)?)?$/,
		stop: /^ア(?:ソート|そーと)なぞなぞ\s*終了$/,
	};

	eventClient.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.username === BOTNAME) {
			return;
		}

		if (state.type === 'Sleeping' && commands.start.test(message.text || '')) {
			const match = (message.text as string).match(commands.start);

			let specifiedLength: number | null = null;
			let found: Candidate[];
			if (match.groups.specifiedLength) {
				specifiedLength = parseInt(match.groups.specifiedLength, 10);
				found = candidateWords.filter(([_, answer]) => [...answer].length === specifiedLength);
				if (found.length === 0) {
					found = candidateWords.filter(([_, answer]) => [...answer].length >= specifiedLength);
				}
			} else {
				found = candidateWords;
			}

			const [title, answer, source, _meaning, id] = sample(found);
			const sorted = getSortedString(answer);
			const wordUrl = getWordUrl(title, source, id);

			const { ts: thread } = await webClient.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					ソート前の文字列を当ててね

					＊${sorted}＊
				`,
				username: BOTNAME,
				icon_emoji: BOTICON,
			}) as ChatPostMessageResult;

			const timeout = calculateTimeout(answer);

			await webClient.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					${timeout} 秒以内にこのスレッドに返信してね
				`,
				username: BOTNAME,
				icon_emoji: BOTICON,
				thread_ts: thread,
			});

			const timeoutId = setTimeout(async () => {
				if (state.type !== 'Answering') return;

				const { title, answer, wordUrl, thread } = state;
				state = { type: 'Sleeping' };

				await webClient.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						答えは ＊${title}＊／＊${answer}＊ だよ :triumph:
						<${wordUrl}|${getPageTitle(wordUrl)}>
					`,
					username: BOTNAME,
					icon_emoji: BOTICON,
					thread_ts: thread,
					reply_broadcast: true,
				});
			}, timeout * 1000);

			state = { type: 'Answering', title, answer, sorted, wordUrl, thread, timeoutId };
			return;
		}

		if (state.type === 'Answering' && message.thread_ts === state.thread) {
			if (message.text === state.answer) {
				const { title, answer, wordUrl, thread, timeoutId } = state;
				state = { type: 'Sleeping' };
				clearTimeout(timeoutId);

				await webClient.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						<@${message.user}> 正解 :tada:
						答えは ＊${title}＊／＊${answer}＊ だよ :muscle:
						${wordUrl}
					`,
					username: BOTNAME,
					icon_emoji: BOTICON,
					thread_ts: thread,
					reply_broadcast: true,
				});

				await increment(message.user, 'sorting-riddles-answer');
				const actualLength = [...answer].length;
				if (actualLength >= 4) {
					await unlock(message.user, 'sorting-riddles-4-or-more-characters');
				}
				if (actualLength >= 7) {
					await unlock(message.user, 'sorting-riddles-7-or-more-characters');
				}
				if (actualLength >= 10) {
					await unlock(message.user, 'sorting-riddles-10-or-more-characters');
				}
			} else {
				await webClient.reactions.add({
					name: 'no_good',
					channel: message.channel,
					timestamp: message.ts,
				});
			}
			return;
		}

		if (state.type === 'Answering' && message.thread_ts !== state.thread && commands.start.test(message.text || '')) {
			await webClient.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					現在解答中だよ。終了するには「ソートなぞなぞ 終了」と送信してね。
				`,
				username: BOTNAME,
				icon_emoji: BOTICON,
			});
			return;
		}

		if (state.type === 'Answering' && message.thread_ts !== state.thread && commands.stop.test(message.text || '')) {
			const { title, answer, wordUrl, timeoutId } = state;
			state = { type: 'Sleeping' };
			clearTimeout(timeoutId);
			await webClient.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					解答を終了したよ :pensive:
					答えは ＊${title}＊／＊${answer}＊ だよ :muscle:
					${wordUrl}
				`,
				username: BOTNAME,
				icon_emoji: BOTICON,
				thread_ts: message.ts,
				reply_broadcast: true,
			});
			return;
		}
	});
}
