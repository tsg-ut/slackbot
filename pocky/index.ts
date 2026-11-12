import * as emoji from 'node-emoji';
import {unlock} from '../achievements/index.js';
import logger from '../lib/logger';
import {getMemberName} from '../lib/slackUtils';
import State from '../lib/state';
import type {SlackInterface} from '../lib/slack';
import type {GenericMessageEvent} from '@slack/bolt';
import {PockyGameBot} from './quiz';
import {fetchGoogleSuggestions, normalize} from './util';

const log = logger.child({bot: 'pocky'});

const stripRe = /^[、。？！,.，．…・?!：；:;\s]+|[、。？！,.，．…・?!：；:;\s]+$/g;

const ignoreRe = /( 英語| 韓国語| 中国語|の?意味|meaning|とは)+$/i;

async function reply(text: string, index: number): Promise<string | null> {
	try {
		const suggestions = await fetchGoogleSuggestions(text);
		return generateReply(text, suggestions, index);
	} catch (e) {
		log.error(e);
		return "エラーΩ＼ζ°)ﾁｰﾝ";
	}
}

function generateReply(text: string, words: string[], index: number): string | null {
	const strippedText = text.replace(stripRe, "");
	const normalizedText = normalize(strippedText);
	const isAlphabet = /[a-z]$/.test(normalizedText);
	const trailers = words.map((word) => {
		const myWord = word.replace(ignoreRe, "").trim();
		if (!normalize(myWord).startsWith(normalizedText)) {
			return false;
		}
		const trailer = myWord.slice(normalizedText.length);
		// let result = "";
		// for (const token of trailer.split(/(\s+)/)) {
		// 	result += token;
		// 	if (token.replace(stripRe, "") !== "") {
		// 		break;
		// 	}
		// }
		const result = trailer;
		return normalize(result).replace(stripRe, "") ? result : false;
	}).filter(Boolean) as string[];
	let sortedTrailers = trailers;
	if (!isAlphabet) {
		const trailersSpaced: string[] = [];
		const trailersNospaced: string[] = [];
		trailers.forEach((trailer) => {
			(trailer[0] === " " ? trailersSpaced : trailersNospaced).push(trailer);
		});
		sortedTrailers = trailersNospaced.concat(trailersSpaced);
	}
	// logger.info(sortedTrailers);
	if (sortedTrailers.length <= index) {
		return null;
	}
	return sortedTrailers[index].replace(stripRe, "");
}

function slackDecode(text: string): string {
	let result = text.replace(/<([^>]+)>/g, (str, cont) => {
		const m = /.+\|(.+)/.exec(cont);
		if (m) {
			return m[1];
		}
		if (/^[@#!]/.test(cont)) {
			return "";
		}
		return cont;
	}).replace(/&(lt|gt|amp);/g, (str, m1) => ({
		lt: "<",
		gt: ">",
		amp: "&",
	} as {[key: string]: string})[m1]);
	result = emoji.emojify(result);
	result = result.replace(/^>\s*/mg, ""); // blockquote
	result = result.trim();
	return result;
}

function htmlEscape(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export default async (clients: SlackInterface) => {
	const {eventClient, webClient: slack} = clients;

	const state = await State.init('pocky', {
		quineSolutions: [] as string[],
		longQuineSolutions: [] as string[],
	});

	function postMessage(message: string, channel: string, postThreadOptions: {broadcast?: boolean; threadPosted?: string | null} = {}) {
		const {broadcast, threadPosted} = {
			broadcast: false,
			threadPosted: null,
			...postThreadOptions,
		};
		return slack.chat.postMessage({
			channel,
			text: message,
			username: "pocky",
			icon_emoji: ":google:",
			thread_ts: threadPosted ? threadPosted : null,
			reply_broadcast: broadcast,
		});
	}

	eventClient.on('message', async (message: GenericMessageEvent) => {
		if (message.subtype) {
			return;
		}
		const {channel, text, thread_ts} = message;
		const isGamesChannel = channel === process.env.CHANNEL_GAMES;
		if (channel !== process.env.CHANNEL_SANDBOX && !isGamesChannel) {
			return;
		}
		// #tsgbot-games のスレッドはポッキーゲームの回答に使われるため、サジェストの対象外とする
		if (isGamesChannel && thread_ts) {
			return;
		}
		const query = slackDecode(text.trim());
		const match = /([\s\S]+?)([？?]+)$/.exec(query);
		if (!match) {
			return;
		}
		const result = await reply(match[1], match[2].length - 1);
		if (result !== null) {
			postMessage(htmlEscape(result), channel, {broadcast: false, threadPosted: thread_ts});
			unlock(message.user, "pocky");
			getMemberName(message.user).then((value) => {
				if (value === result) {
					unlock(message.user, "self-pocky");
				}
			}, (error: Error) => {
				log.error("error:", error.message);
			});
			if (Array.from(result).length >= 20) {
				unlock(message.user, "long-pocky");
			}
			if (match[1] === result && !state.quineSolutions.includes(result)) {
				unlock(message.user, "quine-pocky");
				state.quineSolutions.push(result);
			}
			if (Array.from(result).length >= 20 && match[1] === result && !state.longQuineSolutions.includes(result)) {
				unlock(message.user, "long-quine-pocky");
				state.longQuineSolutions.push(result);
			}
			const date = new Date().toLocaleString('en-US', {
				timeZone: 'Asia/Tokyo',
				month: 'numeric',
				day: 'numeric',
			});
			if (date === '11/11') {
				unlock(message.user, "pocky-on-nov-11");
			}
		}
	});

	return new PockyGameBot(clients);
};
