const {sample} = require('lodash');
const tts = require('google-tts-api');
const moment = require('moment');
const querystring = require('querystring');
const assert = require('assert');

const state = {
	phase: 'waiting',
	ts: null,
	answer: null,
	users: [],
};

const setState = (newState) => {
	Object.assign(state, newState);
};

/**
 * @param {string} text text
 * @return {string[]} phrases
 */
const getPhrasesOf = (text) => text.match(/../g) || [];

const phrases = getPhrasesOf('はっつくパンツかひっつくパンツかくっつくパンツかむかつくパンツか');

const voiper = (num = 8) => Array(num).fill().map(() => sample(phrases)).join('');

const getTtsLink = async (text) => {
	const link = await tts(text, 'ja', 1);
	return (`<${link}|${text}>`);
};

const getTimeLink = (time, title = '宣言締切') => {
	const text = moment(time).utcOffset('+0900').format('HH:mm:ss');
	const url = `https://www.timeanddate.com/countdown/generic?${querystring.stringify({
		iso: moment(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
		p0: 248,
		msg: title,
		font: 'sansserif',
		csz: 1,
	})}`;
	return `<!date^${moment(time).valueOf() / 1000 | 0}^{time_secs}^${url}|${text}>`;
};

const sleepUntil = (time) => new Promise((resolve) => setTimeout(resolve, time - Date.now()));

const hitblow = (seq1, seq2) => {
	assert(seq1.length === seq2.length);
	const hits = [];
	const nohits = [];
	Array(seq1.length).fill().forEach((_, i) => {
		if (seq1[i] === seq2[i]) {
			hits.push(i);
		} else {
			nohits.push(i);
		}
	});
	const nohitCount1 = new Map();
	const nohitCount2 = new Map();
	for (const i of nohits) {
		const word1 = seq1[i];
		const word2 = seq2[i];
		nohitCount1.set(word1, nohitCount1.has(word1) ? nohitCount1.get(word1) + 1 : 1);
		nohitCount2.set(word2, nohitCount2.has(word2) ? nohitCount2.get(word2) + 1 : 1);
	}
	const blow = [...new Set([...nohitCount1.keys(), ...nohitCount2.keys()]).values()].map((word) => {
		if (nohitCount1.has(word) && nohitCount2.has(word)) {
			return Math.min(nohitCount1.get(word), nohitCount2.get(word));
		}
		return 0;
	}).reduce((a, b) => a + b, 0);
	return {
		hit: hits.length,
		blow,
	};
};

module.exports = (/** @type {{
	rtmClient: import('@slack/client').RTMClient,
	webClient: import('@slack/client').WebClient,
}} */{rtmClient: rtm, webClient: slack}
) => {
	rtm.on('message', async (message) => {
		// if (message.channel !== process.env.CHANNEL_SANDBOX) {
		// if (!message.channel.startsWith('D')) {
		if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'voiperrobot') {
			return;
		}

		const postMessage = (text) => slack.chat.postMessage({
			channel: message.channel,
			text,
			username: 'voiperrobot',
			icon_url: 'https://i.gyazo.com/f0d6407563bf2cb1f4cddbce3f0b74f6.png',
		});

		if (message.text === 'ボイパーロボット' || message.text.match(/^@voiperrobot\b/)) {
			postMessage(await getTtsLink(voiper()));
			return;
		}
		if (message.text === 'ボイパーロボットバトル') {
			if (state.phase !== 'waiting' || state.users.includes(message.user)) {
				postMessage(':ha:');
				return;
			}
			slack.reactions.add({
				name: 'ok_hand',
				channel: message.channel,
				timestamp: message.ts,
			});
			if (state.ts) {
				state.users.push(message.user);
			} else {
				const registerDeadline = new Date(Date.now() + 60 * 1000);
				// const registerDeadline = new Date(Date.now() + 1 * 1000);
				setState({
					answer: voiper(4),
					users: [message.user],
					ts: message.ts,
				});
				console.log(state.answer);
				postMessage(`ボイパーロボットバトルをはじめるよ〜:raised_hand_with_fingers_splayed::sunglasses:\nほかのみんなも${getTimeLink(registerDeadline)}までに「ボイパーロボットバトル」と宣言して参加登録してね。`);
				await sleepUntil(registerDeadline);
				setState({phase: 'answering'});
				while (true) {
					const answerDeadline = new Date(Date.now() + 60 * 1000);
					postMessage(`<@${state.users[0]}>さんの解答ターンだよ。\n${state.answer.length}文字のボイパーを${getTimeLink(answerDeadline, '解答締切')}までに解答してね。`);
					await sleepUntil(answerDeadline);
					if (state.phase !== 'answering' || message.ts !== state.ts) {
						return;
					}
					await postMessage(`<@${state.users.shift()}>さんは間に合わなかったみたいだね。残念:cry:`);
					if (state.users.length === 0) {
						postMessage(`だれも正解できなかったよ:cry:\n正解は ${await getTtsLink(state.answer)} だよ。`);
						setState({phase: 'waiting', answer: null, users: [], ts: null});
						return;
					}
				}
			}
			return;
		}
		if (state.phase === 'answering' && message.user === state.users[0] && message.text.length === state.answer.length) {
			if (message.text === state.answer) {
				postMessage(`正解です!:tada:\n${await getTtsLink(state.answer)}`);
				setState({phase: 'waiting', answer: null, users: [], ts: null});
			} else {
				const {hit, blow} = hitblow(getPhrasesOf(state.answer), getPhrasesOf(message.text));
				postMessage(`「${message.text}」は違うよ:thinking_face:(${hit}H${blow}B)`);
			}
		}
	});
};
