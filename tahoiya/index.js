const {stripIndent} = require('common-tags');
const moment = require('moment');
const querystring = require('querystring');
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
const schedule = require('node-schedule');
const sqlite = require('sqlite');
const sql = require('sql-template-strings');

const state = (() => {
	try {
		// eslint-disable-next-line global-require
		const savedState = require('./state.json');
		return {
			phase: savedState.phase,
			author: savedState.author || null,
			authorHistory: savedState.authorHistory || [],
			isWaitingDaily: savedState.isWaitingDaily || false,
			candidates: savedState.candidates,
			meanings: new Map(Object.entries(savedState.meanings)),
			shuffledMeanings: savedState.shuffledMeanings,
			bettings: new Map(Object.entries(savedState.bettings)),
			theme: savedState.theme,
			ratings: new Map(Object.entries(savedState.ratings)),
			comments: savedState.comments || [],
			stashedDaily: savedState.stashedDaily || null,
		};
	} catch (e) {
		return {
			phase: 'waiting',
			isWaitingDaily: false,
			author: null,
			authorHistory: [],
			candidates: [],
			meanings: new Map(),
			shuffledMeanings: [],
			bettings: new Map(),
			theme: null,
			ratings: new Map(),
			comments: [],
			stashedDaily: null,
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
	const db = await sqlite.open(path.join(__dirname, 'themes.sqlite3'));

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
		if (source !== 'wikipedia' && source !== 'wiktionary') {
			return rawMeaning;
		}

		let wikitext = null;
		let exsentences = 0;

		await axios.post(
			(source === 'wikipedia' ? 'https://ja.wikipedia.org/w/api.php?' : 'https://ja.wiktionary.org/w/api.php?') + querystring.stringify({
				action: 'purge',
				titles: word,
				format: 'json',
			}),
			{
				responseType: 'json',
			},
		);

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
						redirects: 1,
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
			return '';
		}

		console.log(wikitext);

		let meaning = null;
		const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

		if (lines.length > 1) {
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

	const getTimeLink = (time) => {
		const text = moment(time).utcOffset('+0900').format('HH:mm:ss');
		const url = `https://www.timeanddate.com/countdown/generic?${querystring.stringify({
			iso: moment(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
			p0: 248,
			msg: 'たほいや登録終了まで',
			font: 'sansserif',
			csz: 1,
		})}`;
		return `<${url}|${text}>`;
	};

	let timeoutId = null;

	const [
		wikipediaText,
		wiktionaryText,
		nicopediaText,
		asciiText,
		binaryText,
		ewordsText,
		fideliText,
	] = await Promise.all([
		['wikipedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wikipedia.txt'],
		['wiktionary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wiktionary.txt'],
		['nicopedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/nicopedia.txt'],
		['ascii.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ascii.txt'],
		['binary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/binary.txt'],
		['ewords.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ewords.txt'],
		['fideli.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/fideli.txt'],
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

	const databaseWords = [
		...wikipediaText.split('\n').filter((line) => line.length !== 0).map((line) => [
			...line.split('\t'),
			'wikipedia',
		]),
		...wiktionaryText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
			'wiktionary',
		]),
		...nicopediaText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
			'nicopedia',
			line.split('\t')[2],
		]),
		...asciiText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			line.split('\t')[1],
			'ascii',
			line.split('\t')[2],
		]),
		...binaryText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			line.split('\t')[1],
			'binary',
			line.split('\t')[2],
		]),
		...ewordsText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			line.split('\t')[1],
			'ewords',
			line.split('\t')[2],
		]),
		...fideliText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			line.split('\t')[1],
			'fideli',
			line.split('\t')[2],
			line.split('\t')[3],
		]),
	];

	const candidateWords = shuffle(databaseWords.filter(([, ruby]) => ruby.length >= 3 && ruby.length <= 7));

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

	const getWordUrl = (word, source, id) => {
		if (source === 'wikipedia') {
			return `https://ja.wikipedia.org/wiki/${encodeURIComponent(word)}`;
		}

		if (source === 'wiktionary') {
			return `https://ja.wiktionary.org/wiki/${encodeURIComponent(word)}`;
		}

		if (source === 'ascii') {
			return `http://yougo.ascii.jp/caltar/${encodeURIComponent(word)}`;
		}

		if (source === 'binary') {
			return `http://www.sophia-it.com/content/${encodeURIComponent(word)}`;
		}

		if (source === 'ewords') {
			return `http://e-words.jp/w/${encodeURIComponent(word)}.html`;
		}

		if (source === 'fideli') {
			return `http://dic-it.fideli.com/dictionary/m/word/w/${encodeURIComponent(id)}/index.html`;
		}

		assert(source === 'nicopedia');
		return `http://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
	};

	const getPageTitle = (url) => {
		const urlTitle = decodeURI(url.match(/([^/]+)$/)[1]);

		if (url.startsWith('https://ja.wikipedia.org')) {
			return `${urlTitle} - Wikipedia`;
		}

		if (url.startsWith('https://ja.wiktionary.org')) {
			return `${urlTitle} - ウィクショナリー日本語版`;
		}

		if (url.startsWith('http://yougo.ascii.jp')) {
			return `${urlTitle} - 意味・説明・解説 : ASCII.jpデジタル用語辞典`;
		}

		if (url.startsWith('http://www.sophia-it.com')) {
			return `${urlTitle} - IT用語辞典バイナリ`;
		}

		if (url.startsWith('http://e-words.jp')) {
			const rawUrlTitle = urlTitle.replace(/\.html$/, '');
			return `${rawUrlTitle} - IT用語辞典`;
		}

		if (url.startsWith('http://dic-it.fideli.com/')) {
			return 'フィデリ IT用語辞典';
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

		if (source === 'ascii') {
			return 'http://ascii.jp/img/favicon.ico';
		}

		if (source === 'binary') {
			return 'http://www.sophia-it.com/favicon.ico';
		}

		if (source === 'ewords') {
			return 'http://p.e-words.jp/favicon.png';
		}

		if (source === 'fideli') {
			return 'http://dic-it.fideli.com/image/favicon.ico';
		}

		assert(source === 'nicopedia');
		return 'http://dic.nicovideo.jp/favicon.ico';
	};

	const updateGist = async (battleTimestamp) => {
		const newBattle = {
			timestamp: battleTimestamp,
			theme: state.theme.ruby,
			word: state.theme.word,
			sourceString: state.theme.sourceString,
			url: state.author === null ? getWordUrl(state.theme.word, state.theme.source, state.theme.id) : state.theme.url,
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
			author: state.author,
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

		for (const [i, {timestamp, theme, word, meanings, url, author, sourceString}] of battles.entries()) {
			const users = meanings.filter(({type}) => type === 'user').map(({user}) => user);

			entries.push(`
				# 第${offset + i + 1}回 「**${theme}**」

				* **日時** ${moment(timestamp).utcOffset('+0900').format('YYYY-MM-DD HH:mm:ss')}
				* **参加者** ${users.map((user) => `@${getMemberName(user)}`).join(' ')} (${users.length}人)
				${author ? `* **出題者**: @${getMemberName(author)}` : ''}

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

				出典: [${sourceString ? `${word} - ${sourceString}` : getPageTitle(url)}](${url})

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
			await setState({phase: 'waiting', theme: null, author: null});
			await postMessage('参加者がいないのでキャンセルされたよ:face_with_rolling_eyes:');
			return;
		}

		if (state.author !== null && state.meanings.size < 3) {
			await setState({
				phase: 'waiting',
				theme: null,
				author: null,
				stashedDaily: {
					theme: {
						word: state.theme.word,
						ruby: state.theme.ruby,
						meaning: state.theme.meaning,
						source: state.theme.sourceString,
						url: state.theme.url,
						user: state.author,
					},
					meanings: [...state.meanings.entries()],
				},
			});
			await postMessage('参加者が最少催行人数 (3人) より少ないので今日のデイリーたほいやはキャンセルされたよ:face_with_rolling_eyes:');
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
			const word = (i === 0 && state.author === null && ambiguateDummy !== undefined) ? ambiguateDummy : sample(candidateWords);
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
			全員ぶん出揃うか${state.author === null ? '3' : '30'}分が経過すると結果発表だよ:sunglasses:
		`, shuffledMeanings.map((meaning, index) => ({
			text: `${index + 1}. ${meaning.text}`,
			color: colors[index],
		})));

		timeoutId = setTimeout(onFinishBettings, (state.author === null ? 3 : 30) * 60 * 1000);
	};

	const onFinishBettings = async () => {
		assert(state.phase === 'collect_bettings');

		const timestamp = new Date().toISOString();

		const correctMeaningIndex = state.shuffledMeanings.findIndex(({user, dummy}) => user === null && dummy === null);
		const correctMeaning = state.shuffledMeanings[correctMeaningIndex];
		const correctBetters = [...state.bettings.entries()].filter(([, {meaning}]) => meaning === correctMeaningIndex);

		const newRatings = new Map([
			...state.meanings.keys(),
			...(state.author ? [state.author] : []),
		].map((user) => [user, 0]));

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

		if (state.author) {
			const correctCount = correctBetters.length;
			const wrongCount = state.meanings.size - correctCount;

			newRatings.set(state.author, newRatings.get(state.author) + wrongCount - correctCount);
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
				text: ratings.map((rating, i) => ratings.length - 1 === i && (state.meanings.has(user) || state.author === user) ? `*${formatNumber(rating)}*` : formatNumber(rating)).join(', '),
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

			${state.author === null ? getWordUrl(state.theme.word, state.theme.source) : state.theme.url}
		`, [], {unfurl_links: true});

		await postMessage('今回の対戦結果', state.shuffledMeanings.map((meaning, index) => {
			const url = (() => {
				if (meaning.dummy) {
					return getWordUrl(meaning.dummy[0], meaning.dummy[2]);
				}

				if (meaning.user) {
					return `https://${team.domain}.slack.com/team/${meaning.user}`;
				}

				if (state.author === null) {
					return getWordUrl(state.theme.word, state.theme.source);
				}

				return state.theme.url;
			})();

			const title = (() => {
				if (meaning.dummy) {
					return getPageTitle(url);
				}

				if (meaning.user) {
					return `@${getMemberName(meaning.user)}`;
				}

				if (state.author === null) {
					return getPageTitle(url);
				}

				return `${state.theme.word} - ${state.theme.sourceString}`;
			})();

			const icon = (() => {
				if (meaning.dummy) {
					return getIconUrl(meaning.dummy[2]);
				}

				if (meaning.user) {
					return getMemberIcon(meaning.user);
				}

				if (state.author === null) {
					return getIconUrl(state.theme.source);
				}

				return getMemberIcon(state.author);
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

		if (state.author) {
			await db.run(sql`
				UPDATE themes
				SET done = 1
				WHERE ruby = ${state.theme.ruby}
			`);
		}

		updateGist(timestamp);

		await setState({
			phase: 'waiting',
			author: null,
			...(state.author ? {
				authorHistory: state.authorHistory
					.filter((author) => author !== state.author)
					.concat([state.author]),
			} : {}),
			theme: null,
			shuffledMeanings: [],
			meanings: new Map(),
			bettings: new Map(),
			comments: [],
		});

		if (state.isWaitingDaily) {
			startDaily();
		}
	};

	const startDaily = async () => {
		assert(state.phase === 'waiting');

		await setState({
			phase: 'collect_meanings',
			isWaitingDaily: false,
		});

		// 最近選ばれてないユーザーを選ぶ
		let theme = null;

		if (state.stashedDaily !== null) {
			theme = state.stashedDaily.theme;
		} else if (state.authorHistory.length > 0) {
			theme = await db.get(`
				SELECT *
				FROM themes
				WHERE user NOT IN (${state.authorHistory.map(() => '?').join(',')})
					AND done = 0
				ORDER BY RANDOM()
				LIMIT 1
			`, [...state.authorHistory]);
		} else {
			theme = await db.get(sql`
				SELECT *
				FROM themes
				WHERE done = 0
				ORDER BY RANDOM()
				LIMIT 1
			`);
		}

		if (!theme) {
			for (const author of state.authorHistory) {
				theme = await db.get(sql`
					SELECT *
					FROM themes
					WHERE user = ${author}
						AND done = 0
					ORDER BY RANDOM()
					LIMIT 1
				`);

				if (theme) {
					break;
				}
			}
		}

		if (!theme) {
			await setState({phase: 'waiting'});
			await postMessage('お題ストックが無いのでデイリーたほいやはキャンセルされたよ:cry:');
			return;
		}

		const meanings = new Map(state.stashedDaily === null ? [] : state.stashedDaily.meanings);

		await setState({
			candidates: [],
			theme: {
				word: theme.word,
				ruby: theme.ruby,
				meaning: normalizeMeaning(theme.meaning),
				source: null,
				sourceString: theme.source,
				url: theme.url,
				id: null,
			},
			author: theme.user,
			stashedDaily: null,
			meanings,
		});

		const end = Date.now() + 90 * 60 * 1000;
		setTimeout(onFinishMeanings, 90 * 60 * 1000);

		axios.post('https://slack.com/api/chat.postMessage', {
			channel: process.env.CHANNEL_SANDBOX,
			text: '@tahoist',
		}, {
			headers: {
				Authorization: `Bearer ${process.env.HAKATASHI_TOKEN}`,
			},
		});

		await postMessage(stripIndent`
			今日のデイリーたほいやが始まるよ:checkered_flag::checkered_flag::checkered_flag:
			出題者: <@${theme.user}>

			今日のお題は *「${state.theme.ruby}」* だよ:v:
			参加者は90分以内にこの単語の意味を考えて <@${process.env.USER_TSGBOT}> にDMしてね:relaxed:
			終了予定時刻: ${getTimeLink(end)}
			${meanings.size === 0 ? '' : `登録済み: ${[...meanings.keys()].map((user) => `<@${user}>`).join(', ')}`}
		`);
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

				if (state.candidates.some(([, ruby]) => ruby === text)) {
					assert(state.phase === 'waiting');
					await setState({phase: 'collect_meanings'});

					const [word, ruby, source, rawMeaning, id] = state.candidates.find(([, r]) => r === text);
					await setState({candidates: []});

					const meaning = await getMeaning([word, ruby, source, rawMeaning, id]);

					await setState({theme: {word, ruby, meaning, source, id}});

					const end = Date.now() + 3 * 60 * 1000;
					setTimeout(onFinishMeanings, 3 * 60 * 1000);

					await postMessage(stripIndent`
						お題を *「${ruby}」* にセットしたよ:v:
						参加者は3分以内にこの単語の意味を考えて <@${process.env.USER_TSGBOT}> にDMしてね:relaxed:
						終了予定時刻: ${getTimeLink(end)}
					`);
					return;
				}

				if (text === 'デイリーたほいや') {
					await postMessage('ヘルプ: https://github.com/tsg-ut/slackbot/wiki/%E3%83%87%E3%82%A4%E3%83%AA%E3%83%BC%E3%81%9F%E3%81%BB%E3%81%84%E3%82%84');
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

				const tokens = text.trim().split(/\s+/);

				if (tokens[0] === 'デイリーたほいや') {
					if (tokens[1] === '一覧') {
						const themes = await db.all(sql`
							SELECT *
							FROM themes
							WHERE user = ${message.user}
								AND done = 0
						`);
						const attachments = themes.map(({word, ruby, meaning, source, url}) => ({
							author_name: `${word} (${ruby}) - ${source}`,
							author_link: url,
							text: meaning,
						}));
						await postDM('あなたが登録したお題一覧', attachments);
						return;
					}

					if (tokens[1] === '登録') {
						const themeTokens = text.split('登録')[1].trim().split('\n');

						if (themeTokens.length !== 5) {
							await postDM('行数がおかしいよ:gorilla:');
							return;
						}

						const [word, ruby, rawMeaning, source, url] = themeTokens;
						const meaning = normalizeMeaning(rawMeaning);

						const existingRecord = await db.get(sql`
							SELECT 1
							FROM themes
							WHERE ruby = ${hiraganize(ruby)}
							LIMIT 1
						`);

						if (existingRecord !== undefined) {
							await postDM(`「${ruby}」はすでに登録されているよ:innocent:`);
							return;
						}

						if (word === '') {
							await postDM('単語が空だよ:thinking_face:');
							return;
						}

						if (ruby === '' || !hiraganize(ruby).match(/^\p{Script_Extensions=Hiragana}+$/u)) {
							await postDM('読み仮名は平仮名でないといけないよ:pouting_cat:');
							return;
						}

						if (meaning === '' || meaning.length > 256) {
							await postDM('意味が空だよ:dizzy_face:');
							return;
						}

						if (source === '') {
							await postDM('ソースが空だよ:scream:');
							return;
						}

						if (!url.match(/^<.+>$/)) {
							await postDM('URLがおかしいよ:nauseated_face:');
							return;
						}

						await db.run(sql`
							INSERT INTO themes (
								user,
								word,
								ruby,
								meaning,
								source,
								url,
								ts,
								done
							) VALUES (
								${message.user},
								${word},
								${hiraganize(ruby)},
								${meaning},
								${source},
								${url.replace(/^</, '').replace(/>$/, '')},
								${Math.floor(Date.now() / 1000)},
								0
							)
						`);

						await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});

						const stocks = await db.all(`
							SELECT user, count(user) as cnt
							FROM themes
							WHERE done = 0
							GROUP BY user
							ORDER BY cnt DESC
						`);

						await postMessage(stripIndent`
							<@${message.user}> がデイリーたほいやのお題を登録したよ:muscle:
							現在のお題ストック
						`, stocks.map(({user, cnt: count}, index) => ({
							text: `@${getMemberName(user)}: ${count}個`,
							color: colors[index],
						})));
						return;
					}

					if (tokens[1] === '削除') {
						const ruby = tokens[2];

						if (!ruby) {
							await postDM('削除するお題の読み仮名を指定してね:face_with_monocle:');
							return;
						}

						const result = await db.run(sql`
							DELETE FROM themes
							WHERE user = ${message.user}
								AND done = 0
								AND ruby = ${ruby}
						`);

						if (result.stmt.changes > 0) {
							await postDM(`「${ruby}」を削除したよ:x:`);
						} else {
							await postDM(`「${ruby}」は見つからなかったよ:hankey:`);
						}

						return;
					}

					await postDM('ヘルプ: https://github.com/tsg-ut/slackbot/wiki/%E3%83%87%E3%82%A4%E3%83%AA%E3%83%BC%E3%81%9F%E3%81%BB%E3%81%84%E3%82%84');
					return;
				}

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
					if (state.author === message.user) {
						await postDM('出題者はたほいやに参加できないよ:fearful:');
						return;
					}

					const isUpdate = state.meanings.has(message.user);
					state.meanings.set(message.user, normalizeMeaning(text));
					await setState({meanings: state.meanings});

					await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});
					if (!isUpdate) {
						const remainingText = state.author === null ? '' : (
							state.meanings.size > 3 ? '' : (
								state.meanings.size === 3 ? '(決行決定:tada:)'
									: `(決行まであと${3 - state.meanings.size}人)`
							)
						);
						await postMessage(stripIndent`
							<@${message.user}> が意味を登録したよ:muscle:
							現在の参加者: ${state.meanings.size}人 ${remainingText}
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

	schedule.scheduleJob('0 22 * * *', () => {
		if (state.phase === 'waiting') {
			startDaily();
		} else {
			setState({
				isWaitingDaily: true,
			});
		}
	});
};
