const axios = require('axios');
const { stripIndent } = require('common-tags');
const sample = require('lodash/sample');
const {
	getPageTitle,
	getWordUrl,
	getCandidateWords,
} = require('../tahoiya/lib');

const BOTNAME = 'sort-nazonazo';
const BOTICON = ':abc:';
const TIMEOUT = 1000 * 60;

const getSortedString = (answer) => {
	return [...answer].sort((a, b) => {
		return a.codePointAt(0) - b.codePointAt(0);
	}).join('');
};

const getRandomTitle = async () => {
	const { data } = await axios.get(`https://ja.wikipedia.org/w/api.php`, {
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

module.exports = async ({ rtmClient: rtm, webClient: slack }) => {
	const state = {
		title: null,
		answer: null,
		wordUrl: null,
		sorted: null,
		thread: null,
		timeoutId: null,
		clear() {
			this.title = null;
			this.answer = null;
			this.wordUrl = null;
			this.sorted = null;
			this.thread = null;
			this.timeoutId = null;
		},
	};

	const candidateWords = await getCandidateWords({ min: 0, max: Infinity });

	const command = /^ソートなぞなぞ\s*(?:(?<length>[1-9][0-9]?)文字)?$/;

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (command.test(message.text || '') && state.answer === null) {
			const match = message.text.match(command);

			let found;
			if (match.groups.length) {
				const length = parseInt(match.groups.length, 10);
				found = candidateWords.filter(([_, answer]) => answer.length === length);
				if (found.length === 0) {
					found = candidateWords.filter(([_, answer]) => answer.length >= length);
				}
			} else {
				found = candidateWords;
			}

			const [title, answer, source, _meaning, id] = sample(found);
			state.title = title;
			state.answer = answer;

			const sorted = getSortedString(answer);
			state.sorted = sorted;

			const wordUrl = getWordUrl(title, source, id);
			state.wordUrl = wordUrl;

			const { ts } = await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					ソート前の文字列を当ててね
					\`${sorted}\`
				`,
				username: BOTNAME,
				icon_emoji: BOTICON,
			});
			state.thread = ts;

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					60 秒以内にこのスレッドに返信してね
				`,
				username: BOTNAME,
				icon_emoji: BOTICON,
				thread_ts: state.thread,
			});

			const timeoutId = setTimeout(async () => {
				const { title, answer, wordUrl, thread } = state;
				state.clear();

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						答えは＊${title}＊／＊${answer}＊だよ:triumph:
						<${wordUrl}|${getPageTitle(wordUrl)}>
					`,
					username: BOTNAME,
					icon_emoji: BOTICON,
					thread_ts: thread,
					reply_broadcast: true,
				});
			}, TIMEOUT);
			state.timeoutId = timeoutId;
		}

		if (state.answer !== null && message.thread_ts === state.thread && message.username !== BOTNAME) {
			if (message.text === state.answer) {
				const { title, answer, wordUrl, thread, timeoutId } = state;
				state.clear();
				clearTimeout(timeoutId);

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						<@${message.user}> 正解:tada:
						答えは＊${title}＊／＊${answer}＊だよ:muscle:
						${wordUrl}
					`,
					username: BOTNAME,
					icon_emoji: BOTICON,
					thread_ts: thread,
					reply_broadcast: true,
				});
			} else {
				await slack.reactions.add({
					name: 'no_good',
					channel: message.channel,
					timestamp: message.ts,
				});
			}
		}
	});
}
