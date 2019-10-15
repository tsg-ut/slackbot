const axios = require('axios');
const { stripIndent } = require('common-tags');

const BOTNAME = 'sort-nazonazo';
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

module.exports = ({ rtmClient: rtm, webClient: slack }) => {
	const state = {
		answer: null,
		sorted: null,
		thread: null,
		timeoutId: null,
	};

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if ((message.text || '').trim() === `ソートなぞなぞ` && state.answer === null) {
			const answer = await getRandomTitle();
			state.answer = answer;

			const sorted = getSortedString(answer);
			state.sorted = sorted;

			const { ts } = await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					ソート前の文字列を当ててね
					${sorted}
				`,
				username: BOTNAME,
			});
			state.thread = ts;

			const timeoutId = setTimeout(async () => {
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						正解は
						${answer}
						でした！
					`,
					username: BOTNAME,
					thread_ts: state.thread,
					reply_broadcast: true,
				});
				state.answer = null;
				state.sorted = null;
				state.thread = null;
				state.timeoutId = null;
			}, TIMEOUT);
			state.timeoutId = timeoutId;
		}

		if (state.answer !== null && message.thread_ts === state.thread && message.username !== BOTNAME) {
			if (message.text === state.answer) {
				clearTimeout(state.timeoutId);
				state.timeoutId = null;

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						<@${message.user}> 正解:tada:
						答えは＊${state.answer}＊だよ:muscle:
					`,
					username: BOTNAME,
					thread_ts: state.thread,
					reply_broadcast: true,
				});
				state.answer = null;
				state.sorted = null;
				state.thread = null;
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
