const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const axios = require('axios');
const {stripIndent} = require('common-tags');
const levenshtein = require('fast-levenshtein');
const {hiraganize} = require('japanese');
const get = require('lodash/get');
const maxBy = require('lodash/maxBy');
const minBy = require('lodash/minBy');
const random = require('lodash/random');
const sample = require('lodash/sample');
const sampleSize = require('lodash/sampleSize');
const shuffle = require('lodash/shuffle');
const sum = require('lodash/sum');
const nodePersist = require('node-persist');
const schedule = require('node-schedule');
const {default: Queue} = require('p-queue');
const rouge = require('rouge');
const sql = require('sql-template-strings');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const {unlock, increment} = require('../achievements');
const getReading = require('../lib/getReading.js');

const {default: logger} = require('../lib/logger.ts');
const bot = require('./bot.js');
const gist = require('./gist.js');
const {
	getPageTitle,
	getWordUrl,
	getIconUrl,
	getTimeLink,
	getMeaning,
	getCandidateWords,
	normalizeMeaning,
} = require('./lib.js');

const timeCollectMeaningNormal = 3 * 60 * 1000;
const timeCollectMeaningDaily = 90 * 60 * 1000;
const timeCollectBettingDaily = 30 * 60 * 1000;
const timeExtraAddition = 60 * 1000;

let timeoutId = null;

const queue = new Queue({concurrency: 1});

const transaction = (func) => queue.add(func);

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const state = (() => {
		try {
			// eslint-disable-next-line global-require
			const savedState = require('./state.json');
			if (savedState.endThisPhase != null) {
				assert(savedState.phase !== 'waiting');
				const difftime = savedState.endThisPhase - Date.now();
				if (difftime <= 0) {
					logger.info("tahoiya ends its phase while deploy, hence add extra time");
					savedState.endThisPhase = Date.now() + timeExtraAddition;
				}
				switch (savedState.phase) {
					case 'collect_meanings':
						setTimeout(onFinishMeanings, savedState.endThisPhase - Date.now());
						break;
					case 'collect_bettings':
						timeoutId = setTimeout(onFinishBettings, savedState.endThisPhase - Date.now());
						break;
					case 'waiting':
					default:
						break;
				}
			}
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
				endThisPhase: savedState.endThisPhase || null,
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
				endThisPhase: null,
			};
		}
	})();

	const db = await sqlite.open({
		filename: path.join(__dirname, 'themes.sqlite3'),
		driver: sqlite3.Database,
	});

	const storage = nodePersist.create({
		dir: path.resolve(__dirname, '__cache__'),
	});
	await storage.init();

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


	const candidateWords = await getCandidateWords();

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
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		const member = members.find(({id}) => id === user);
		return member.profile.display_name || member.name;
	};

	const getMemberIcon = (user) => {
		if (user === 'tahoiyabot-01' || user === 'tahoiyabot-02') {
			return 'https://emojipedia-us.s3.dualstack.us-west-1.amazonaws.com/thumbs/120/apple/155/robot-face_1f916.png';
		}

		const member = members.find(({id}) => id === user);
		return member.profile.image_24;
	};

	const getMention = (user) => {
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		return `<@${user}>`;
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
		const gistData = await axios.get(`https://api.github.com/gists/${latestGist.id}`);
		const json = get(gistData, ['data', 'files', 'tahoiya-1-data.json', 'content']);

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

		const markdown = gist.serialize({battles, offset}, members);

		if (process.env.NODE_ENV !== 'production') {
			await promisify(fs.writeFile)(path.join(__dirname, 'tahoiya-0-logs.md'), markdown);
			return;
		}

		postMessage(`対戦ログ: <https://gist.github.com/hakatashi/${latestGist.id}#${encodeURIComponent(`第${offset + battles.length}回-${newBattle.theme}`)}>`);

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

	async function onFinishMeanings() {
		const humanCount = Array.from(state.meanings.keys()).filter((user) => user.startsWith('U')).length;
		if (state.author !== null && humanCount < 3) {
			await setState({
				phase: 'waiting',
				theme: null,
				author: null,
				meanings: new Map(),
				comments: [],
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
					comments: state.comments,
				},
				endThisPhase: null,
			});
			await postMessage('参加者が最少催行人数 (3人) より少ないので今日のデイリーたほいやはキャンセルされたよ:face_with_rolling_eyes:');
			return;
		}

		if (humanCount === 0) {
			await setState({phase: 'waiting', theme: null, author: null, meanings: new Map(), endThisPhase: null});
			await postMessage('参加者がいないのでキャンセルされたよ:face_with_rolling_eyes:');
			return;
		}

		await setState({
			phase: 'collect_bettings',
			endThisPhase: Date.now() + state.author === null ? timeCollectBettingNormal : timeCollectMeaningDaily,
		});
		const dummySize = Math.max(1, 4 - state.meanings.size);
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
			${[...state.meanings.keys()].filter((user) => user.startsWith('U')).map((user) => getMention(user)).join(' ')}
			ベッティングタイムが始まるよ～:open_hands::open_hands::open_hands:
			下のリストから *${state.theme.ruby}* の正しい意味だと思うものを選んで、 <@${process.env.USER_TSGBOT}> に「nにm枚」とDMしてね:wink:
			全員ぶん出揃うか${state.author === null ? '3' : '30'}分が経過すると結果発表だよ:sunglasses:
		`, shuffledMeanings.map((meaning, index) => ({
			text: `${index + 1}. ${meaning.text}`,
			color: colors[index],
		})));

		for (const better of ['tahoiyabot-01', 'tahoiyabot-02']) {
			if (state.meanings.has(better)) {
				const {index: betMeaning} = maxBy(
					shuffledMeanings
						.map((meaning, index) => ({...meaning, index}))
						.filter(({user}) => user !== better),
					({text}) => sum([1, 2, 3].map((n) => (
						Math.min(text.length, state.meanings.get(better).length) < n
							? 0
							: rouge.n(text, state.meanings.get(better), {
								n,
								tokenizer: (s) => Array.from(s),
							}) * (10 ** n)
					))) + Math.random() * 1e-10,
				);
				state.bettings.set(better, {
					meaning: betMeaning,
					coins: 1,
				});
				await setState({bettings: state.bettings});
				await postMessage(`${getMention(better)} がBETしたよ:moneybag:`);
			}
		}

		timeoutId = setTimeout(onFinishBettings, state.author === null ? timeCollectBettingNormal : timeCollectBettingDaily);

		if (humanCount >= 3) {
			for (const user of state.meanings.keys()) {
				if (user.startsWith('U')) {
					await increment(user, 'tahoiyaParticipate');
				}
			}
		}
	};

	async function onFinishBettings() {
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

		const humanCount = Array.from(state.meanings.keys()).filter((user) => user.startsWith('U')).length;

		if (state.author) {
			const correctCount = correctBetters.filter(([user]) => user.startsWith('U')).length;
			const wrongCount = humanCount - correctCount;

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

			正解者: ${correctBetters.length === 0 ? 'なし' : correctBetters.map(([better]) => getMention(better)).join(' ')}

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
				text: [...state.bettings.entries()].filter(([, {meaning}]) => meaning === index).map(([better, {coins}]) => `${getMention(better)} (${coins}枚)`).join(' ') || '-',
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

		const oldBettings = state.bettings;
		const oldMeanings = state.shuffledMeanings;

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
			endThisPhase: null,
		});

		if (state.isWaitingDaily) {
			startDaily();
		}

		for (const [user, rating] of newRatings.entries()) {
			if (rating >= 6) {
				await unlock(user, 'tahoiya-over6');
			}
			if (rating >= 10) {
				await unlock(user, 'tahoiya-over10');
			}
			const ratings = state.ratings.get(user).slice().reverse();
			if (ratings.length >= 2 && ratings[1].rating - ratings[0].rating >= 10) {
				await unlock(user, 'tahoiya-down10');
			}
		}

		const firstplace = ranking[0][0];
		await unlock(firstplace, 'tahoiya-firstplace');

		const deceiveCounter = new Map();
		for (const [user, {coins, meaning}] of oldBettings.entries()) {
			if (user.startsWith('tahoiyabot')) {
				continue;
			}
			const misdirectedUser = oldMeanings[meaning].user;
			if (misdirectedUser !== null) {
				deceiveCounter.set(misdirectedUser, (deceiveCounter.get(misdirectedUser) || 0) + 1);
				await increment(misdirectedUser, 'tahoiyaDeceive');
				if (misdirectedUser.startsWith('tahoiyabot')) {
					await unlock(user, 'tahoiya-singularity');
				}
				if (!misdirectedUser.startsWith('tahoiyabot')) {
					const otherBetting = oldBettings.get(misdirectedUser);
					if (otherBetting && oldMeanings[otherBetting.meaning].user === user) {
						await unlock(user, 'tahoiya-deceive-each-other');
					}
				}
			}
			if (coins >= 5) {
				await unlock(user, 'tahoiya-5bet');
			}
			if (humanCount >= 3 && meaning === correctMeaningIndex) {
				await increment(user, 'tahoiyaWin');
			}
			if (meaning !== correctMeaningIndex && newRatings.get(user) > 0) {
				await unlock(user, 'tahoiya-positive-coins-without-win');
			}
		}

		for (const [user, count] of deceiveCounter.entries()) {
			if (user.startsWith('tahoiyabot')) {
				continue;
			}
			if (count >= 1) {
				await unlock(user, 'tahoiya-deceive');
			}
			if (count >= 3) {
				await unlock(user, 'tahoiya-deceive3');
			}
		}
	};

	const onBotResult = async ({result, modelName}) => {
		assert(state.phase === 'collect_meanings');

		const distance = levenshtein.get(state.theme.meaning, result);
		logger.info({result, distance});
		if (distance <= Math.max(state.theme.meaning.length, result.length) / 2) {
			return;
		}

		state.meanings.set(modelName, normalizeMeaning(result));
		await setState({meanings: state.meanings});
		await postMessage(stripIndent`
			${getMemberName(modelName)} が意味を登録したよ:robot_face:
		`);
	};

	const startDaily = async () => {
		assert(state.phase === 'waiting');

		const end = Date.now() + 90 * 60 * 1000;
		await setState({
			phase: 'collect_meanings',
			isWaitingDaily: false,
			endThisPhase: end,
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
			await setState({phase: 'waiting', endThisPhase: null});
			await postMessage('お題ストックが無いのでデイリーたほいやはキャンセルされたよ:cry:');
			return;
		}

		const meanings = new Map(state.stashedDaily === null ? [] : state.stashedDaily.meanings);
		const comments = state.stashedDaily === null ? [] : state.stashedDaily.comments;

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
			comments,
			endThisPhase: null,
		});

		setTimeout(onFinishMeanings, timeCollectMeaningDaily);

		axios.post('https://slack.com/api/chat.postMessage', {
			channel: process.env.CHANNEL_SANDBOX,
			text: '@tahoist',
			as_user: true,
		}, {
			headers: {
				Authorization: `Bearer ${process.env.HAKATASHI_TOKEN}`,
			},
		});

		await postMessage(stripIndent`
			今日のデイリーたほいやが始まるよ:checkered_flag::checkered_flag::checkered_flag:
			出題者: ${getMention(theme.user)}

			今日のお題は *「${state.theme.ruby}」* だよ:v:
			参加者は90分以内にこの単語の意味を考えて <@${process.env.USER_TSGBOT}> に「たほいや hoge」とDMしてね:relaxed:
			終了予定時刻: ${getTimeLink(end)}
			${meanings.size === 0 ? '' : `登録済み: ${[...meanings.keys()].map((user) => getMention(user)).join(', ')}`}
		`);

		if (!state.meanings.has('tahoiyabot-01')) {
			await bot.getResult(state.theme.ruby, 'tahoiyabot-01').then(onBotResult);
		}

		if (!state.meanings.has('tahoiyabot-02')) {
			await bot.getResult(state.theme.ruby, 'tahoiyabot-02').then(onBotResult);
		}
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
					logger.info(candidates);
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
					const end = Date.now() + timeCollectMeaningNormal;
					await setState({phase: 'collect_meanings', endThisPhase: end});

					const [word, ruby, source, rawMeaning, id] = state.candidates.find(([, r]) => r === text);
					await setState({candidates: []});

					const meaning = await getMeaning([word, ruby, source, rawMeaning, id]);

					await setState({theme: {word, ruby, meaning, source, id}});

					setTimeout(onFinishMeanings, timeCollectMeaningNormal);

					await postMessage(stripIndent`
						お題を *「${ruby}」* にセットしたよ:v:
						参加者は3分以内にこの単語の意味を考えて <@${process.env.USER_TSGBOT}> に「たほいや hoge」とDMしてね:relaxed:
						終了予定時刻: ${getTimeLink(end)}
					`);


					if (!state.meanings.has('tahoiyabot-01')) {
						await bot.getResult(ruby, 'tahoiyabot-01').then(onBotResult);
					}

					if (!state.meanings.has('tahoiyabot-02')) {
						await bot.getResult(ruby, 'tahoiyabot-02').then(onBotResult);
					}

					return;
				}

				if (text === 'デイリーたほいや') {
					postMessage('ヘルプ: https://github.com/tsg-ut/slackbot/wiki/%E3%83%87%E3%82%A4%E3%83%AA%E3%83%BC%E3%81%9F%E3%81%BB%E3%81%84%E3%82%84');
					return;
				}

				if (text.startsWith('@tahoiya') || text.match(/(って(なに|何)|とは)[？?⋯…・]*$/)) {
					const isMention = text.startsWith('@tahoiya');
					const body = text.replace(/^@\w+/, '').replace(/(って(なに|何)|とは)[？?⋯…・]*$/, '').trim();
					const ruby = hiraganize(await getReading(body)).replace(/[^\p{Script=Hiragana}ー]/gu, '');
					const modelData = text.startsWith('@tahoiya2') ? (
						['tahoiyabot-02', 'model.ckpt-600001-ver2']
					) : text.startsWith('@tahoiya') ? (
						['tahoiyabot-01', 'model.ckpt-455758']
					) : (
						['tahoiyabot-02', 'model.ckpt-600001-ver2']
					);

					if (ruby.length > 0 && ruby.length <= 25) {
						if (state.theme && levenshtein.get(state.theme.ruby, ruby) <= 2) {
							isMention && postMessage('カンニング禁止！:imp:');
							return;
						}

						const key = JSON.stringify([...modelData, ruby]);
						const tempData = await storage.getItem(key);

						if (tempData) {
							await postMessage(stripIndent`
								*${ruby}* の正しい意味は⋯⋯
								*${random(1, 5)}. ${tempData.result}*
							`, null, {
								username: getMemberName(modelData[0]),
								thread_ts: message.ts,
								reply_broadcast: true,
							});
							return;
						}

						if (queue.size >= 2) {
							isMention && postMessage(`今忙しいから *${ruby}* は後で:upside_down_face:`);
							return;
						}

						transaction(async () => {
							let data = await storage.getItem(key);
							if (!data) {
								let thinking = true;
								const sendTyping = () => {
									rtm.sendTyping(message.channel);
									setTimeout(() => {
										if (thinking) {
											sendTyping();
										}
									}, 3000);
								};

								try {
									sendTyping();
									data = await bot.getResult(ruby, modelData[0]);
									thinking = false;
									await storage.setItem(key, data);
								} catch (error) {
									thinking = false;
									failed(error);
								}
							}
							await postMessage(stripIndent`
								*${ruby}* の正しい意味は⋯⋯
								*${random(1, 5)}. ${data.result}*
							`, null, {
								username: getMemberName(modelData[0]),
								thread_ts: message.ts,
								reply_broadcast: true,
							});
						});
						return;
					}

					isMention && postMessage(':ha:');
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
							${getMention(message.user)} がデイリーたほいやのお題を登録したよ:muscle:
							現在のお題ストック
						`, stocks.map(({user, cnt: count}, index) => ({
							text: `@${getMemberName(user)}: ${count}個`,
							color: colors[index],
						})));

						await unlock(message.user, 'daily-tahoiya-theme');

						return;
					}

					if (tokens[1] === '削除') {
						const [, , ruby] = tokens;

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

				if (text.startsWith('たほいや') && state.phase === 'collect_meanings' && text.length <= 256) {
					if (state.author === message.user) {
						await postDM('出題者はたほいやに参加できないよ:fearful:');
						return;
					}
					const registeredMeaning = text.slice(4).trim();
					const isUpdate = state.meanings.has(message.user);
					state.meanings.set(message.user, normalizeMeaning(registeredMeaning));
					await setState({meanings: state.meanings});

					await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});
					if (!isUpdate) {
						const humanCount = Array.from(state.meanings.keys()).filter((user) => user.startsWith('U')).length;
						const remainingText = state.author === null ? '' : (
							humanCount > 3 ? '' : (
								humanCount === 3 ? '(決行決定:tada:)'
									: `(決行まであと${3 - humanCount}人)`
							)
						);
						await postMessage(stripIndent`
							${getMention(message.user)} が意味を登録したよ:muscle:
							現在の参加者: ${humanCount}人 ${remainingText}
						`);
						await unlock(message.user, 'tahoiya');
					}
					return;
				}

				if ((matches = text.match(/^(\d+)に(\d+)枚$/)) && state.phase === 'collect_bettings') {
					if (!state.meanings.has(message.user)) {
						await postDM(`${getMention(message.user)} は参加登録していないのでベッティングできないよ:innocent:`);
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

					const humanCount = Array.from(state.meanings.keys()).filter((user) => user.startsWith('U')).length;
					if (betCoins > humanCount) {
						await postDM(`参加者の人数 (${humanCount}人) より多い枚数はBETできないよ:white_frowning_face:`);
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
						await postMessage(`${getMention(message.user)} さんがBETしたよ:moneybag:`);
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

	schedule.scheduleJob('0 21 * * *', () => {
		if (state.phase === 'waiting') {
			startDaily();
		} else {
			setState({
				isWaitingDaily: true,
			});
		}
	});
};
