const request = require("request");
const emoji = require("node-emoji");

const { RTM_EVENTS } = require("@slack/client")

const stripRe = /^[、。？！,.，．…・?!：；:;\s]+|[、。？！,.，．…・?!：；:;\s]+$/g;

const ignoreRe = /( 英語| 韓国語| 中国語|の?意味|meaning|とは)+$/i;

function reply(text, index) {
	return new Promise((resolve, reject) => {
		request({
			url: "https://www.google.com/complete/search?client=firefox&hl=ja&q=" + encodeURIComponent(text),
			headers: {
				"User-Agent": "Mozilla/5.0",
			},
			json: true,
			method: "GET",
		}, (error, response, body) => {
			if (error || !response || response.statusCode !== 200 || !body) {
				console.error(error, response, body);
				resolve("エラーΩ＼ζ°)ﾁｰﾝ");
				return;
			}
			const data = generateReply(text, body[1], index);
			resolve(data);
		});
	});
}

function generateReply(text, words, index) {
	// console.log(text, words, index);
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
		return result.replace(stripRe, "") ? result : false;
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
	// console.log(sortedTrailers);
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
		slack.chat.postMessage(channel, message, {
			as_user: false,
			username: "pocky",
			icon_emoji: ":google:",
		});
	}
	rtm.on(RTM_EVENTS.MESSAGE, async (message) => {
		if (message.subtype) {
			return;
		}
		const { channel, text, user, ts: timestamp } = message;
		if (channel !== process.env.CHANNEL) {
			return;
		}
		const query = slackDecode(text.trim());
		const match = /([\s\S]+?)([？?]+)$/.exec(query);
		if (!match) {
			return;
		}
		const result = await reply(match[1], match[2].length - 1);
		const response = (result === null) ? ":wakarazu:" : result;
		postMessage(`<@${user}> ` + htmlEscape(response), channel);
	});
};
