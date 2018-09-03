const {stripIndent} = require('common-tags');
const moment = require('moment');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');
const download = require('download');
const assert = require('assert');
const get = require('lodash/get');
const sample = require('lodash/sample');
const sampleSize = require('lodash/sampleSize');
const sum = require('lodash/sum');
const last = require('lodash/last');
const maxBy = require('lodash/maxBy');
const minBy = require('lodash/minBy');
const shuffle = require('lodash/shuffle');
const {hiraganize} = require('japanese');
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
			comments: savedState.comments || [],
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
			comments: [],
		};
	}
})();

const normalizeMeaning = (input) => {
	let meaning = input;
	meaning = meaning.replace(/== (.+?) ==/g, '$1');
	meaning = meaning.replace(/\(.+?\)/g, '');
	meaning = meaning.replace(/（.+?）/g, '');
	meaning = meaning.replace(/【.+?】/g, '');
	meaning = meaning.replace(/。.*$/, '');
	meaning = meaning.replace(/^.+? -/, '');
	meaning = meaning.replace(/(のこと|をいう|である)+$/, '');
	return meaning.trim();
};

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const mapToObject = (map) => {
		const object = {};
		for (const [key, value] of map.entries()) {
			if (!key) {
				continue;
			}
			object[key.toString()] = value;
		}
		return object;
	};

	const setState = async (newState) => {
		Object.assign(state, newState);

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

	const getMeaning = async ([word, , source, rawMeaning]) => {
		if (source === 'nicopedia') {
			return rawMeaning;
		}

		let wikitext = null;
		let exsentences = 0;

		do {
			exsentences++;

			const response = await axios.get(
				source === 'wikipedia' ? 'https://ja.wikipedia.org/w/api.php' : 'https://ja.wiktionary.org/w/api.php',
				{
					params: {
						action: 'query',
						prop: 'extracts',
						titles: word,
						exlimit: 1,
						...(source === 'wikipedia' ? {exintro: true} : {}),
						explaintext: true,
						exsentences,
						format: 'json',
					},
					responseType: 'json',
				},
			);

			const pages = get(response, ['data', 'query', 'pages']);
			if (typeof pages === 'object') {
				wikitext = get(Object.values(pages), [0, 'extract'], null);
			}
		} while (exsentences < 3 && (wikitext === null || wikitext.endsWith('?')));

		if (!wikitext) {
			await failed(new Error(`Couldn't find article for ${word}`));
			return;
		}

		console.log(wikitext);

		let meaning = null;
		const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

		if (lines.length !== 1) {
			meaning = source === 'wikipedia' ? lines[1] : last(lines);
			meaning = normalizeMeaning(meaning);
		} else {
			meaning = normalizeMeaning(wikitext);
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
			meaning = meaning.replace(/であり、.+$/, '');
			meaning = meaning.replace(/で、.+$/, '');
		}

		meaning = meaning.trim();

		return meaning;
	};

	let timeoutId = null;

	const [databaseText, wiktionaryText, nicopediaText] = await Promise.all([
		['data.txt', 'https://john-smith.github.io/kana.tsv'],
		['wiktionary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wiktionary.txt'],
		['nicopedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/nicopedia.txt'],
	].map(async ([filename, url]) => {
		const dataPath = path.join(__dirname, filename);

		const dataExists = await new Promise((resolve) => {
			fs.access(dataPath, fs.constants.F_OK, (error) => {
				resolve(!error);
			});
		});

		if (dataExists) {
			const databaseBuffer = await promisify(fs.readFile)(dataPath);
			return databaseBuffer.toString();
		}

		{
			const databaseBuffer = await download(url);
			await promisify(fs.writeFile)(dataPath, databaseBuffer);
			return databaseBuffer.toString();
		}
	}));

	const database = [
		...databaseText.split('\n').filter((line) => line.length !== 0).map((line) => [
			...line.split('\t'),
			'wikipedia',
		]),
		...wiktionaryText.split('\n').filter((line) => line.length !== 0).map((line) => [
			...line.split('\t'),
			'wiktionary',
		]),
		...nicopediaText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
			'nicopedia',
			line.split('\t')[2],
		]),
	];

	const candidateWords = shuffle(database.filter(([word, ruby]) => ruby.length >= 3 && ruby.length <= 7));

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

	const {members} = await slack.users.list();
	const {team} = await slack.team.info();

	const getMemberName = (user) => {
		const member = members.find(({id}) => id === user);
		return member.profile.display_name || member.name;
	};

	const getMemberIcon = (user) => {
		const member = members.find(({id}) => id === user);
		return member.profile.image_24;
	};

	const getWordUrl = (word, source) => {
		if (source === 'wikipedia') {
			return `https://ja.wikipedia.org/wiki/${encodeURIComponent(word)}`;
		}

		if (source === 'wiktionary') {
			return `https://ja.wiktionary.org/wiki/${encodeURIComponent(word)}`;
		}

		{
			assert(source === 'nicopedia');
			return `http://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
		}
	};

	const getPageTitle = (url) => {
		const urlTitle = decodeURI(url.match(/([^/]+)$/)[1]);

		if (url.startsWith('https://ja.wikipedia.org')) {
			return `${urlTitle} - Wikipedia`;
		}

		if (url.startsWith('https://ja.wiktionary.org')) {
			return `${urlTitle} - ウィクショナリー日本語版`;
		}

		assert(url.startsWith('http://dic.nicovideo.jp'));
		return `${urlTitle} - ニコニコ大百科`;
	};

	const getIconUrl = (source) => {
		if (source === 'wikipedia') {
			return 'https://ja.wikipedia.org/static/favicon/wikipedia.ico';
		}

		if (source === 'wiktionary') {
			return 'https://ja.wiktionary.org/static/favicon/piece.ico';
		}

		assert(source === 'nicopedia');
		return 'http://dic.nicovideo.jp/favicon.ico';
	};

	const updateGist = async (battleTimestamp) => {
		const newBattle = {
			timestamp: battleTimestamp,
			theme: state.theme.ruby,
			url: getWordUrl(state.theme.word, state.theme.source),
			meanings: state.shuffledMeanings.map((meaning, index) => {
				const type = meaning.dummy ? 'dummy' : (meaning.user ? 'user' : 'correct');
				return {
					text: meaning.text,
					type,
					...(type === 'dummy' ? {source: meaning.dummy[2], title: meaning.dummy[0]} : {}),
					...(type === 'user' ? {user: meaning.user} : {}),
					betters: [...state.bettings.entries()].filter(([, {meaning}]) => meaning === index).map(([user, {coins}]) => ({user, coins})),
				};
			}),
			comments: state.comments,
		};

		const {data: gists} = await axios.get('https://api.github.com/users/hakatashi/gists');
		let latestGist = maxBy(gists.filter(({description}) => description.startsWith(`[${process.env.TEAMNAME}] `)), 'created_at');
		const gist = await axios.get(`https://api.github.com/gists/${latestGist.id}`);
		const json = get(gist, ['data', 'files', 'tahoiya-1-data.json', 'content']);

		if (!json) {
			return;
		}

		let {battles, offset} = JSON.parse(json);

		if (battles.length >= 100) {
			const {data: newGist} = await axios.post('https://api.github.com/gists', {
				description: '',
				files: {
					'tahoiya-0-logs.md': {
						content: '# temp',
					},
					'tahoiya-1-data.json': {
						content: JSON.stringify({battles: [], offset: offset + 100}),
					},
				},
				public: true,
			}, {
				headers: {
					Authorization: `token ${process.env.GITHUB_TOKEN}`,
				},
			});

			latestGist = newGist;
			battles = [];
			offset += 100;
		}

		battles.push(newBattle);

		const entries = [];

		postMessage(`対戦ログ: <https://gist.github.com/hakatashi/${latestGist.id}#${encodeURIComponent(`第${offset + battles.length}回-${newBattle.theme}`)}>`);

		for (const [i, {timestamp, theme, meanings, url}] of battles.entries()) {
			const users = meanings.filter(({type}) => type === 'user').map(({user}) => user);

			entries.push(`
				# 第${offset + i + 1}回 「**${theme}**」

				* **日時** ${moment(timestamp).utcOffset('+0900').format('YYYY-MM-DD HH:mm:ss')}
				* **参加者** ${users.map((user) => `@${getMemberName(user)}`).join(' ')} (${users.length}人)

				${meanings.map((meaning, i) => `${i + 1}. ${meaning.text}`).join('\n')}

				<details>

				<summary>答え</summary>

				${meanings.map((meaning, i) => {
		let text = '';
		if (meaning.type === 'user') {
			text = `${i + 1}. ${meaning.text} (@${getMemberName(meaning.user)})`;
		} else if (meaning.type === 'dummy') {
			text = `${i + 1}. ${meaning.text} (${meaning.source}: ${meaning.title})`;
		} else if (meaning.type === 'correct') {
			text = `${i + 1}. ⭕️**${meaning.text}**`;
		}

		const betters = meaning.betters.map(({user, coins}) => `@${getMemberName(user)} (${coins}枚)`).join(' ');

		if (betters.length > 0) {
			return `${text}\n    * ${betters}`;
		}

		return text;
	}).join('\n')}

				出典: [${getPageTitle(url)}](${url})

				</details>
			`.replace(/^\t+/gm, ''));
		}

		const markdown = entries.join('\n');

		await axios.patch(`https://api.github.com/gists/${latestGist.id}`, {
			description: `[${process.env.TEAMNAME}] たほいや対戦ログ 第${offset + 1}回～第${offset + 100}回`,
			files: {
				'tahoiya-0-logs.md': {
					content: markdown,
				},
				'tahoiya-1-data.json': {
					content: JSON.stringify({battles, offset}),
				},
			},
		}, {
			headers: {
				Authorization: `token ${process.env.GITHUB_TOKEN}`,
			},
		});
	};

	const postMessage = (text, attachments, options) => (
		slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text,
			username: 'tahoiya',
			// eslint-disable-next-line camelcase
			icon_emoji: ':open_book:',
			...(attachments ? {attachments} : {}),
			...(options ? options : {}),
		})
	);

	const failed = (error) => (
		postMessage(error.stack)
	);

	const onFinishMeanings = async () => {
		if (state.meanings.size === 0) {
			await postMessage('参加者がいないのでキャンセルされたよ:face_with_rolling_eyes:');
			await setState({phase: 'waiting', theme: null});
			return;
		}

		await setState({phase: 'collect_bettings'});
		const dummySize = Math.max(2, 4 - state.meanings.size);
		const ambiguateDummy = minBy(candidateWords, ([word, ruby]) => {
			const distance = levenshtein.get(state.theme.ruby, ruby);
			if (distance === 0 || state.theme.word === word) {
				return Infinity;
			}
			return distance;
		});

		const dummyMeanings = await Promise.all(Array(dummySize).fill().map(async (_, i) => {
			const word = (i === 0 && ambiguateDummy !== undefined) ? ambiguateDummy : sample(candidateWords);
			const meaning = await getMeaning(word);

			return {
				user: null,
				dummy: word,
				text: meaning,
			};
		}));

		const shuffledMeanings = shuffle([{
			user: null,
			dummy: null,
			text: state.theme.meaning,
		}, ...[...state.meanings.entries()].map(([user, text]) => ({
			user,
			dummy: null,
			text,
		})), ...dummyMeanings]);

		await setState({shuffledMeanings});

		await postMessage(stripIndent`
			${[...state.meanings.keys()].map((user) => `<@${user}>`).join(' ')}
			ベッティングタイムが始まるよ～:open_hands::open_hands::open_hands:
			下のリストから *${state.theme.ruby}* の正しい意味だと思うものを選んで、 <@${process.env.USER_TSGBOT}> に「nにm枚」とDMしてね:wink:
			全員ぶん出揃うか3分が経過すると結果発表だよ:sunglasses:
		`, shuffledMeanings.map((meaning, index) => ({
			text: `${index + 1}. ${meaning.text}`,
			color: colors[index],
		})));

		timeoutId = setTimeout(onFinishBettings, 3 * 60 * 1000);
	};

	const onFinishBettings = async () => {
		assert(state.phase === 'collect_bettings');

		const timestamp = new Date().toISOString();

		const correctMeaningIndex = state.shuffledMeanings.findIndex(({user, dummy}) => user === null && dummy === null);
		const correctMeaning = state.shuffledMeanings[correctMeaningIndex];
		const correctBetters = [...state.bettings.entries()].filter(([, {meaning}]) => meaning === correctMeaningIndex);

		const newRatings = new Map([...state.meanings.keys()].map((user) => [user, 0]));

		for (const user of state.meanings.keys()) {
			const betting = state.bettings.get(user) || {meaning: null, coins: 1};

			if (betting.meaning === correctMeaningIndex) {
				newRatings.set(user, newRatings.get(user) + betting.coins);
			} else {
				newRatings.set(user, newRatings.get(user) - betting.coins - 1);
				if (betting.meaning !== null) {
					const misdirectedUser = state.shuffledMeanings[betting.meaning].user;
					if (misdirectedUser !== null) {
						newRatings.set(misdirectedUser, newRatings.get(misdirectedUser) + betting.coins);
					}
				}
			}
		}

		for (const [user, newRating] of newRatings.entries()) {
			if (!state.ratings.has(user)) {
				state.ratings.set(user, []);
			}

			const oldRatings = state.ratings.get(user);
			oldRatings.push({timestamp, rating: newRating});

			while (oldRatings.length > 5) {
				oldRatings.shift();
			}
		}
		await setState({ratings: state.ratings});

		const currentScores = [...state.ratings.entries()].map(([user, ratings]) => ([
			user,
			ratings.map(({timestamp: rateTimestamp, rating}) => {
				if (rating <= -6) {
					return rating;
				}

				const duration = new Date(timestamp).getTime() - new Date(rateTimestamp).getTime();
				const days = duration / 1000 / 60 / 60 / 24;
				const degeneratedRating = Math.ceil((rating - days * 0.2) * 10) / 10;
				return Math.max(-6, degeneratedRating);
			}),
		]));

		const sumScores = (scores) => (
			sum([...scores, ...Array(5 - scores.length).fill(-6)])
		);

		const ranking = currentScores.sort(([, a], [, b]) => sumScores(b) - sumScores(a));
		const hiRanking = ranking.filter(([, ratings]) => sumScores(ratings) > -30);
		const loRanking = ranking.filter(([, ratings]) => sumScores(ratings) <= -30);

		const formatNumber = (number) => number >= 0 ? `+${number.toFixed(1)}` : `${number.toFixed(1)}`;

		await postMessage('現在のランキング', [
			...hiRanking.map(([user, ratings], index) => ({
				author_name: `#${index + 1}: @${getMemberName(user)} (${formatNumber(sumScores(ratings))}点)`,
				author_link: `https://${team.domain}.slack.com/team/${user}`,
				author_icon: getMemberIcon(user),
				text: ratings.map((rating, index) => ratings.length - 1 === index && state.meanings.has(user) ? `*${formatNumber(rating)}*` : formatNumber(rating)).join(', '),
				color: colors[index % colors.length],
			})),
			{
				author_name: `#${hiRanking.length + 1}: ${loRanking.map(([user]) => `@${getMemberName(user)}`).join(', ')} (-30.0点)`,
				color: '#CCCCCC',
			},
		]);

		await postMessage(stripIndent`
			集計が終了したよ～:raised_hands::raised_hands::raised_hands:

			*${state.theme.ruby}* の正しい意味は⋯⋯
			*${correctMeaningIndex + 1}. ${correctMeaning.text}*

			正解者: ${correctBetters.length === 0 ? 'なし' : correctBetters.map(([better]) => `<@${better}>`).join(' ')}

			${getWordUrl(state.theme.word, state.theme.source)}
		`, [], {unfurl_links: true});

		await postMessage('今回の対戦結果', state.shuffledMeanings.map((meaning, index) => {
			const url = (() => {
				if (meaning.dummy) {
					return getWordUrl(meaning.dummy[0], meaning.dummy[2]);
				}

				if (meaning.user) {
					return `https://${team.domain}.slack.com/team/${meaning.user}`;
				}

				return getWordUrl(state.theme.word, state.theme.source);
			})();

			const title = (() => {
				if (meaning.dummy) {
					return getPageTitle(url);
				}

				if (meaning.user) {
					return `@${getMemberName(meaning.user)}`;
				}

				return getPageTitle(url);
			})();

			const icon = (() => {
				if (meaning.dummy) {
					return getIconUrl(meaning.dummy[2]);
				}

				if (meaning.user) {
					return getMemberIcon(meaning.user);
				}

				return getIconUrl(state.theme.source);
			})();

			return {
				author_name: title,
				author_link: url,
				author_icon: icon,
				title: `${index + 1}. ${meaning.text}`,
				text: [...state.bettings.entries()].filter(([, {meaning}]) => meaning === index).map(([better, {coins}]) => `<@${better}> (${coins}枚)`).join(' ') || '-',
				color: index === correctMeaningIndex ? colors[0] : '#CCCCCC',
			};
		}));

		if (state.comments.length > 0) {
			await postMessage('コメント', [
				...state.comments.map(({user, text, date}) => ({
					author_name: text,
					author_link: `https://${team.domain}.slack.com/team/${user}`,
					author_icon: getMemberIcon(user),
					ts: Math.floor(date / 1000),
				})),
			]);
		}

		updateGist(timestamp);

		await setState({
			phase: 'waiting',
			theme: null,
			shuffledMeanings: [],
			meanings: new Map(),
			bettings: new Map(),
			comments: [],
		});
	};

	rtm.on('message', async (message) => {
		if (!message.text || message.subtype !== undefined) {
			return;
		}

		try {
			const {text} = message;
			let matches = null;

			if (message.channel === process.env.CHANNEL_SANDBOX) {
				if (text === 'たほいや') {
					if (state.phase !== 'waiting') {
						await postMessage('今たほいや中だよ:imp:');
						return;
					}

					const candidates = sampleSize(candidateWords, 10).map(([word, ruby, source, meaning]) => [word, ruby, source, meaning]);
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

				if (state.candidates.some(([, ruby]) => ruby === text)) {
					assert(state.phase === 'waiting');
					await setState({phase: 'collect_meanings'});

					const [word, ruby, source, rawMeaning] = state.candidates.find(([, ruby]) => ruby === text);
					await setState({candidates: []});

					const meaning = await getMeaning([word, ruby, source, rawMeaning]);

					await setState({theme: {word, ruby, meaning, source}});

					await postMessage(stripIndent`
						お題を *「${ruby}」* にセットしたよ:v:
						参加者は3分以内にこの単語の意味を考えて <@${process.env.USER_TSGBOT}> にDMしてね:relaxed:
					`);

					setTimeout(onFinishMeanings, 3 * 60 * 1000);
					return;
				}
			}

			// DM
			if (message.channel.startsWith('D')) {
				const postDM = (text, attachments, options) => (
					slack.chat.postMessage({
						channel: message.channel,
						text,
						username: 'tahoiya',
						// eslint-disable-next-line camelcase
						icon_emoji: ':open_book:',
						...(attachments ? {attachments} : {}),
						...(options ? options : {}),
					})
				);

				if (text.startsWith('コメント')) {
					const comment = text.slice(4).trim();
					await setState({
						comments: state.comments.concat([{
							text: comment,
							date: Date.now(),
							user: message.user,
						}]),
					});
					await slack.reactions.add({name: 'speech_balloon', channel: message.channel, timestamp: message.ts});
					return;
				}

				if (state.phase === 'collect_meanings' && text.length <= 256) {
					const isUpdate = state.meanings.has(message.user);
					state.meanings.set(message.user, normalizeMeaning(text));
					await setState({meanings: state.meanings});

					await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});
					if (!isUpdate) {
						await postMessage(stripIndent`
							<@${message.user}> が意味を登録したよ:muscle:
							現在の参加者: ${state.meanings.size}人
						`);
					}
					return;
				}

				if ((matches = text.match(/^(\d+)に(\d+)枚$/)) && state.phase === 'collect_bettings') {
					if (!state.meanings.has(message.user)) {
						await postDM(`<@${message.user}> は参加登録していないのでベッティングできないよ:innocent:`);
						return;
					}

					const betMeaning = parseInt(matches[1]);
					const betCoins = parseInt(matches[2]);

					if (betMeaning <= 0 || betMeaning > state.shuffledMeanings.length) {
						await postDM('意味番号がおかしいよ:open_mouth:');
						return;
					}

					if (state.shuffledMeanings[betMeaning - 1].user === message.user) {
						await postDM('自分自身には投票できないよ:angry:');
						return;
					}

					if (betCoins > state.meanings.size) {
						await postDM(`参加者の人数 (${state.meanings.size}人) より多い枚数はBETできないよ:white_frowning_face:`);
						return;
					}

					if (![1, 2, 3, 4, 5].includes(betCoins)) {
						await postDM('BETする枚数は1枚から5枚だよ:pouting_cat:');
						return;
					}

					const isUpdate = state.bettings.has(message.user);

					state.bettings.set(message.user, {
						meaning: betMeaning - 1,
						coins: betCoins,
					});
					await setState({bettings: state.bettings});

					await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});
					if (!isUpdate) {
						await postMessage(`<@${message.user}> さんがBETしたよ:moneybag:`);
					}

					if (state.bettings.size === state.meanings.size) {
						clearTimeout(timeoutId);
						onFinishBettings();
					}

					return;
				}
			}
		} catch (error) {
			failed(error);
		}
	});
};
