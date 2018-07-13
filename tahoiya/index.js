const {RTM_EVENTS: {MESSAGE}} = require("@slack/client")
const {stripIndent} = require('common-tags');
const axios = require('axios');
const download = require('download');
const assert = require('assert');
const get = require('lodash/get');
const sample = require('lodash/sample');
const sampleSize = require('lodash/sampleSize');
const sum = require('lodash/sum');
const shuffle = require('lodash/shuffle');
const path = require('path');
const fs = require('fs');
const {promisify} = require('util');

const state = (() => {
	try {
		// eslint-disable-next-line global-require
		const savedState = require('./state.json');
		return {
			phase: savedState.phase,
			candidates: savedState.candidates,
			meanings: new Map(Object.entries(savedState.meanings)),
			shuffledMeanings: savedState.shuffledMeanings,
			bettings: new Map(Object.entries(savedState.bettings)),
			theme: savedState.theme,
			ratings: new Map(Object.entries(savedState.ratings)),
		};
	} catch (e) {
		return {
			phase: 'waiting',
			candidates: [],
			meanings: new Map(),
			shuffledMeanings: [],
			bettings: new Map(),
			theme: null,
			ratings: new Map(),
		};
	}
})();

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const mapToObject = (map) => {
		const object = {};
		for (const [key, value] of map.entries()) {
			object[key.toString()] = value;
		}
		return object;
	};

	const setState = async (newState) => {
		Object.assign(state, newState);
		console.log(newState, state);

		const savedState = {};
		for (const [key, value] of Object.entries(state)) {
			if (value instanceof Map) {
				savedState[key] = mapToObject(value);
			} else {
				savedState[key] = value;
			}
		}

		await promisify(fs.writeFile)(path.join(__dirname, 'state.json'), JSON.stringify(savedState));
	};

	let timeoutId = null;

	const databaseText = await (async () => {
		const dataPath = path.join(__dirname, 'data.txt');

		const dataExists = await new Promise((resolve) => {
			fs.access(dataPath, fs.constants.F_OK, (error) => {
				resolve(!Boolean(error));
			});
		});

		if (dataExists) {
			const databaseBuffer = await promisify(fs.readFile)(dataPath);
			return databaseBuffer.toString();
		}

		{
			const databaseBuffer = await download('https://john-smith.github.io/kana.tsv');
			await promisify(fs.writeFile)(dataPath, databaseBuffer);
			return databaseBuffer.toString();
		}
	})();

	const database = databaseText.split('\n').filter((line) => line.length !== 0).map((line) => line.split('\t'));
	const candidateWords = database.filter(([word, ruby]) => 3 <= ruby.length && ruby.length <= 6);

	const colors = [
		'#F44336',
		'#7E57C2',
		'#0288D1',
		'#388E3C',
		'#F4511E',
		'#607D8B',
		'#EC407A',
		'#5C6BC0',
		'#00838F',
		'#558B2F',
		'#8D6E63',
		'#AB47BC',
		'#1E88E5',
		'#009688',
		'#827717',
		'#E65100',
	];

	const postMessage = (text, attachments) => (
		slack.chat.postMessage(process.env.CHANNEL_SANDBOX, text, {
			username: 'tahoiya',
			// eslint-disable-next-line camelcase
			icon_emoji: ':open_book:',
			...(attachments ? {attachments} : {}),
		})
	);

	const failed = (error) => (
		postMessage(error.stack)
	);

	const onFinishBettings = async () => {
		assert(state.phase === 'collect_bettings');

		const correctMeaningIndex = state.shuffledMeanings.findIndex(({user}) => user === null);
		const correctMeaning = state.shuffledMeanings[correctMeaningIndex];
		const correctBetters = [...state.bettings.entries()].filter(([, {meaning}]) => meaning === correctMeaningIndex);

		await new Promise((resolve) => setTimeout(resolve, 1000));

		await postMessage(stripIndent`
			集計が終了したよ～:raised_hands::raised_hands::raised_hands:

			*${state.theme.ruby}* の正しい意味は⋯⋯
			*${correctMeaningIndex + 1}. ${correctMeaning.text}*

			正解者: ${correctBetters.length === 0 ? 'なし' : correctBetters.map(([better]) => `<@${better}>`).join(' ')}

			https://ja.wikipedia.org/wiki/${encodeURIComponent(state.theme.word)}
		`);

		await new Promise((resolve) => setTimeout(resolve, 1000));

		await postMessage('今回の対戦結果～', state.shuffledMeanings.map((meaning, index) => ({
			title: `${index + 1}. ${meaning.text} ${meaning.user ? `by <@${meaning.user}>` : ':o:'}`,
			text: [...state.bettings.entries()].filter(([, {meaning}]) => meaning === index).map(([better]) => `<@${better}>`).join(' ') || '-',
			color: colors[index],
		})));

		const newRatings = new Map([...state.meanings.keys()].map((user) => [user, 0]));

		for (const user of state.meanings.keys()) {
			const betting = state.bettings.get(user) || {meaning: null, coins: 1};

			if (betting.meaning === correctMeaningIndex) {
				newRatings.set(user, newRatings.get(user) + betting.coins);
			} else {
				const misdirectedUser = state.shuffledMeanings[betting.meaning].user;
				newRatings.set(user, newRatings.get(user) - betting.coins - 1);
				newRatings.set(misdirectedUser, newRatings.get(misdirectedUser) + betting.coins);
			}
		}

		for (const [user, newRating] of newRatings.entries()) {
			if (!state.ratings.has(user)) {
				state.ratings.set(user, []);
			}

			const oldRatings = state.ratings.get(user);
			oldRatings.push(newRating);

			while (oldRatings.length > 5) {
				oldRatings.shift();
			}
		}
		await setState({ratings: state.ratings})

		const ranking = [...state.ratings.entries()].sort(([, a], [, b]) => sum(b) - sum(a));
		const formatNumber = (number) => number >= 0 ? `+${number}` : `${number}`;

		await new Promise((resolve) => setTimeout(resolve, 1000));

		await postMessage('ランキング更新～', ranking.map(([user, ratings], index) => ({
			text: `#${index + 1} <@${user}>: ${sum(ratings)} (${ratings.map(formatNumber).join(', ')})`,
			color: colors[index % colors.length],
		})));

		await setState({
			phase: 'waiting',
			theme: null,
			shuffledMeanings: [],
			meanings: new Map(),
			bettings: new Map(),
		});
	};

	rtm.on(MESSAGE, async (message) => {
		if (!message.text || message.subtype !== undefined) {
			return;
		}

		try {
			const {text} = message;
			let matches = null;

			if (message.channel === process.env.CHANNEL_SANDBOX) {
				if (text === 'たほいや') {
					if (state.phase === 'waiting') {
						const candidates = sampleSize(candidateWords, 10);
						await setState({candidates});
						console.log(candidates);
						await postMessage(stripIndent`
							たのしい“たほいや”を始めるよ～:clap::clap::clap:
							下のリストの中からお題にする単語を選んでタイプしてね:wink:
						`, candidates.map(([, ruby], index) => ({
							text: ruby,
							color: colors[index],
						})));
						return;
					}

					if (state.phase === 'collect_meanings') {
						if (state.meanings.size === 0) {
							await postMessage('参加者がいないので始められないよ:face_with_rolling_eyes:');
							return;
						}

						await setState({phase: 'collect_bettings'});

						const shuffledMeanings = shuffle([{
							user: null,
							text: state.theme.meaning,
						}, ...[...state.meanings.entries()].map(([user, text]) => ({
							user,
							text,
						}))]);

						await setState({shuffledMeanings});

						await postMessage(stripIndent`
							ベッティングタイムが始まるよ～:open_hands::open_hands::open_hands:
							下のリストから *${state.theme.ruby}* の正しい意味だと思うものを選んで「nにm枚」とタイプしてね:wink:
							全員ぶん出揃うか3分が経過すると結果発表だよ:sunglasses:
						`, shuffledMeanings.map((meaning, index) => ({
							text: `${index + 1}. ${meaning.text}`,
							color: colors[index],
						})));

						timeoutId = setTimeout(onFinishBettings, 3 * 60 * 1000);
						return;
					}
				}

				if (state.candidates.some(([, ruby]) => ruby === text)) {
					assert(state.phase === 'waiting');
					await setState({phase: 'collect_meanings'});

					const [word, ruby] = state.candidates.find(([, ruby]) => ruby === text);
					await setState({candidates: []});

					const response = await axios.get('https://ja.wikipedia.org/w/api.php', {
						params: {
							action: 'query',
							prop: 'extracts',
							titles: word,
							exlimit: 1,
							exintro: true,
							explaintext: true,
							exsentences: 1,
							format: 'json',
						},
						responseType: 'json',
					});

					const pages = get(response, ['data', 'query', 'pages']);
					if (typeof pages !== 'object') {
						await failed(new Error());
						return;
					}

					const wikitext = get(Object.values(pages), [0, 'extract']);
					if (typeof wikitext !== 'string' || wikitext.length === 0) {
						await failed(new Error());
						return;
					}

					console.log(wikitext);

					let meaning = null;
					const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

					if (lines.length !== 1) {
						meaning = lines[1];
					} else {
						meaning = wikitext.replace(/\(.+?\)/g, '');
						meaning = meaning.replace(/（.+?）/g, '');
						if (meaning.includes('とは、')) {
							meaning = meaning.replace(/^.+?とは、/, '');
						} else if (meaning.includes('は、')) {
							meaning = meaning.replace(/^.+?は、/, '');
						} else if (meaning.includes('とは')) {
							meaning = meaning.replace(/^.+?とは/, '');
						} else if (meaning.includes('、')) {
							meaning = meaning.replace(/^.+?、/, '');
						} else {
							meaning = meaning.replace(/^.+?は/, '');
						}
						meaning = meaning.replace(/^.+?は、/, '');
						meaning = meaning.replace(/であり、.+$/, '');
						meaning = meaning.replace(/で、.+$/, '');
						meaning = meaning.replace(/(のこと|をいう|である|。)+$/, '');
					}

					await setState({theme: {word, ruby, meaning}});

					await postMessage(stripIndent`
						お題を *「${ruby}」* にセットしたよ:v:
						参加者はこの単語の意味を考えて <@${process.env.USER_TSGBOT}> にDMしてね:relaxed:
						全員ぶん揃ったらこのチャンネルでもう一度「たほいや」とタイプしてね:+1:
					`);
					return;
				}

				if ((matches = text.match(/^(\d+)に(\d+)枚$/)) && state.phase === 'collect_bettings') {
					if (!state.meanings.has(message.user)) {
						await postMessage(`<@${message.user}> は参加登録していないのでベッティングできないよ:innocent:`);
						return;
					}

					const betMeaning = parseInt(matches[1]);
					const betCoins = parseInt(matches[2]);

					if (betMeaning <= 0 || betMeaning > state.shuffledMeanings.length) {
						await postMessage(`<@${message.user}> 意味番号がおかしいよ:open_mouth:`);
						return;
					}

					if (![1, 2, 3].includes(betCoins)) {
						await postMessage(`<@${message.user}> BETする枚数は1枚から3枚だよ:pouting_cat:`);
						return;
					}

					state.bettings.set(message.user, {
						meaning: betMeaning - 1,
						coins: betCoins,
					});
					await setState({bettings: state.bettings});

					await postMessage(`<@${message.user}> さんが「${state.shuffledMeanings[betMeaning].text}」に${betCoins}枚BETしたよ:moneybag:`);

					if (state.bettings.size === state.meanings.size) {
						clearTimeout(timeoutId);
						onFinishBettings();
					}

					return;
				}
			}

			// DM
			if (message.channel.startsWith('D')) {
				if (state.phase === 'collect_meanings' && text.length <= 256) {
					state.meanings.set(message.user, text);
					await setState({meanings: state.meanings});

					await slack.chat.postMessage(message.channel, ':+1:', {
						username: 'tahoiya',
						// eslint-disable-next-line camelcase
						icon_emoji: ':open_book:',
					});

					await postMessage(stripIndent`
						<@${message.user}> が意味を登録したよ:muscle:
						現在の参加者: ${state.meanings.size}人
					`);
					return;
				}
			}
		} catch (error) {
			failed(error);
		}
	});
};
