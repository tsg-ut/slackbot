const axios = require("axios");
const emoji = require("node-emoji");
const {unlock} = require("../achievements/index.ts");
const logger = require('../lib/logger.js');

const stripRe = /^[、。？！,.，．…・?!：；:;\s]+|[、。？！,.，．…・?!：；:;\s]+$/g;

const ignoreRe = /( 英語| 韓国語| 中国語|の?意味|meaning|とは)+$/i;

async function reply(text, index) {
	try {
		const response = await axios({
			url: "https://www.google.com/complete/search?client=firefox&hl=ja&q=" + encodeURIComponent(text),
			headers: {
				"User-Agent": "Mozilla/5.0",
			},
			method: "GET",
		});
		return generateReply(text, response.data[1], index);
	} catch (e) {
		logger.error(e);
		return "エラーΩ＼ζ°)ﾁｰﾝ";
	}
}

function generateReply(text, words, index) {
	// logger.info(text, words, index);
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
	}).filter(Boolean);
	let sortedTrailers = trailers;
	if (!isAlphabet) {
		const trailersSpaced = [];
		const trailersNospaced = [];
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

function slackDecode(text) {
	let result = text.replace(/<([^>]+)>/g, (str, cont) => {
		let m = /.+\|(.+)/.exec(cont);
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
	}[m1]));
	result = emoji.emojify(result);
	result = result.replace(/^>\s*/mg, ""); // blockquote
	result = result.trim();
	return result;
}

function htmlEscape(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function normalize(text) {
	return text
		.normalize("NFKC")
		.replace(/\ufe0f/g, "")
		.replace(/\u200d/g, " ")
		.replace(/\u301c/g, "~")
		.toLowerCase();
}

module.exports = (clients) => {
	const { rtmClient: rtm, webClient: slack } = clients;

	function postMessage(message, channel) {
		slack.chat.postMessage({
			channel,
			text: message,
			as_user: false,
			username: "pocky",
			icon_emoji: ":google:",
		});
	}
	rtm.on('message', async (message) => {
		if (message.subtype) {
			return;
		}
		const { channel, text } = message;
		if (channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}
		const query = slackDecode(text.trim());
		const match = /([\s\S]+?)([？?]+)$/.exec(query);
		if (!match) {
			return;
		}
		const result = await reply(match[1], match[2].length - 1);
		if (result !== null) {
			postMessage(htmlEscape(result), channel);
			unlock(message.user, "pocky");
			if (Array.from(result).length >= 20) {
				unlock(message.user, "long-pocky");
			}
		}
	});
};
