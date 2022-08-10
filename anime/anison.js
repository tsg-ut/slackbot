const {promises: fs} = require('fs');
const path = require('path');
const {Mutex} = require('async-mutex');
const levenshtein = require('fast-levenshtein');
const {hiraganize} = require('japanese');
const {tokenize} = require('kuromojin');
const {escapeRegExp, sample, sampleSize, chunk, uniq, sortBy, shuffle} = require('lodash');
const scrapeIt = require('scrape-it');
const {unlock, increment} = require('../achievements');
const {Deferred} = require('../lib/utils.ts');
const {getSongInfo, getMovieInfo} = require('../lyrics/index.ts');
const {loadSheet} = require('./index.js');

const freqDeferred = new Deferred();
const mutex = new Mutex();

const loadFreq = async () => {
	if (freqDeferred.isResolved) {
		return freqDeferred.promise;
	}

	const data = await fs.readFile(path.resolve(__dirname, '../vocabwar/data/frequency.txt'));
	const freq = new Map(data.toString().split('\n').filter((line) => line).map((line) => {
		const [word, frequency] = line.split(' ');
		return [word, parseFloat(frequency)];
	}));
	freqDeferred.resolve(freq);
	return freq;
};

const getHintText = (n) => {
	if (n <= 1) {
		return 'しょうがないにゃあ、ヒントだよ';
	}
	if (n <= 2) {
		return 'もう一つヒントだよ、早く答えてね';
	}
	if (n <= 3) {
		return 'まだわからないの？ヒント追加するからね';
	}
	return '最後のヒントだよ！もうわかるよね？';
};

const getSongInfos = async (title) => {
	const {animeInfos} = await loadSheet();
	const anime = animeInfos.find(({name}) => name === title);
	if (!anime || !anime.utanetId) {
		return [];
	}
	const utanetUrl = `https://www.uta-net.com/user/search/anime_list_2.html?tno=${anime.utanetId}`;
	const {data: {songs}} = await scrapeIt(utanetUrl, {
		songs: {
			listItem: '.list_title + table + table tr',
			data: {
				title: 'td:nth-child(1)',
				link: {
					selector: 'td:nth-child(1) a',
					attr: 'href',
					convert: (link) => new URL(link, utanetUrl).href,
				},
				artist: 'td:nth-child(2)',
				type: 'td:nth-child(3)',
			},
		},
	});
	const songInfos = [];
	for (const song of shuffle(songs)) {
		if (song.type !== 'OP' && song.type !== 'ED') {
			continue;
		}
		const songInfo = await getSongInfo(song.link, '');
		const movieInfo = await getMovieInfo(songInfo.utaNetUrl.replace('song', 'movie'));
		songInfo.tokens = await tokenize(songInfo.paragraphs.join('\n'));
		songInfo.type = song.type;
		songInfo.movie = `https://youtu.be/${movieInfo.id}`;
		songInfo.animeTitle = title;

		songInfo.forbiddenWords = uniq([
			...songInfo.title.split(/\P{Letter}+/u),
			...songInfo.animeTitle.split(/\P{Letter}+/u),
		]).filter((word) => word.length > 2).sort((a, b) => b.length - a.length);

		songInfos.push(songInfo);
		break;
	}
	return songInfos;
};

const mask = (text, words) => {
	let response = text;
	for (const word of words) {
		response = response.replace(new RegExp(escapeRegExp(word), 'igu'), '█'.repeat(word.length));
	}
	return response;
};

const getHint = async (songInfos, n) => {
	const songInfo = sample(songInfos);

	if (n === 0) {
		const nouns = songInfo.tokens.filter((token) => (
			token.pos === '名詞' &&
			!songInfo.forbiddenWords.includes(token.surface_form)
		));
		return chunk(sampleSize(uniq(nouns.map((noun) => noun.basic_form)), 10), 5)
			.map((hints) => hints.map((hint) => `＊${hint}＊`).join(' / '))
			.join('\n');
	}
	if (n === 1) {
		const freq = await loadFreq();
		const words = songInfo.tokens.filter((token) => (
			token.word_type === 'KNOWN' &&
			['名詞', '動詞', '形容詞'].includes(token.pos) &&
			!songInfo.forbiddenWords.includes(token.surface_form)
		));
		const sortedWords = sortBy(uniq(words.map((word) => word.basic_form)), (word) => {
			if (freq.has(word)) {
				return freq.get(word);
			}
			return Infinity;
		}).reverse();
		return chunk(sortedWords.slice(0, 20), 5)
			.map((hints) => hints.map((hint) => `＊${hint}＊`).join(' / '))
			.join('\n');
	}
	if (n === 2) {
		const sentences = sampleSize(songInfo.paragraphs.join('\n').split(/\s+/), 5);
		return sentences.map((sentence) => `＊${mask(sentence, songInfo.forbiddenWords)}＊`).join('\n');
	}
	if (n === 3 || n === 4) {
		const paragraph = sample(songInfo.paragraphs);
		return paragraph.split('\n').map((line) => `＊${mask(line, songInfo.forbiddenWords)}＊`).join('\n');
	}
	return '';
};

module.exports = ({eventClient, webClient: slack}) => {
	const state = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
		songInfos: [],
		thread: null,
		difficulty: null,
	};

	const onTick = () => {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = state.previousHint + (state.hints.length === 5 ? 30 : 15) * 1000;

			if (state.answer !== null && nextHint <= now) {
				state.previousHint = now;
				if (state.hints.length < 5) {
					const hintText = getHintText(state.hints.length);
					const hint = await getHint(state.songInfos, state.hints.length);

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `${hintText}\n\n${hint}`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
					});

					state.hints.push({});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
					]);
					const songInfo = state.songInfos[0];
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `もう、しっかりして！\n答えは ＊${songInfo.title}＊ (${state.answer} ${songInfo.type}) だよ:anger:\n${anger}\n\n${songInfo.movie}`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: songInfo.utaNetUrl,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						unfurl_links: true,
					});
					state.answer = null;
					state.previousHint = 0;
					state.hints = [];
					state.thread = null;
					state.difficulty = null;
				}
			}
			state.previousTick = now;
		});
	};

	setInterval(onTick, 1000);

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		let matches = null;

		if (message.text && (matches = message.text.match(/^アニソン当てクイズ(?<difficulty>easy|normal|hard)?$/)) && state.answer === null) {
			const difficulty = matches.groups.difficulty || 'easy';

			mutex.runExclusive(async () => {
				const {animes, easyAnimes, normalAnimes} = await loadSheet();
				const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));
				let answer = null;
				if (difficulty === 'easy' || difficulty === 'extreme') {
					answer = sample(easyAnimes);
				} else if (difficulty === 'normal') {
					answer = sample(normalAnimes);
				} else {
					answer = sample(animeTitles);
				}

				const songInfos = await getSongInfos(answer);

				if (songInfos.length === 0) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `エラー:cry:\nアニメ: ${answer}`,
						username: 'anime',
						icon_emoji: ':tv:',
					});
					return;
				}

				const {ts} = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: `このアニソンなーんだ\n\n${await getHint(songInfos, 0)}`,
					username: 'anime',
					icon_emoji: ':tv:',
				});

				state.songInfos = songInfos;
				state.thread = ts;
				state.hints.push({});
				state.previousHint = Date.now();
				state.difficulty = difficulty;

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '15秒経過でヒントを出すよ♫',
					username: 'anime',
					icon_emoji: ':tv:',
					thread_ts: ts,
				});

				state.answer = answer;
			});
		}

		if (state.answer !== null && message.text && message.thread_ts === state.thread && message.username !== 'anime') {
			mutex.runExclusive(async () => {
				if (state.answer === null) {
					return;
				}
				const songInfo = state.songInfos[0];
				const answer = hiraganize(state.answer.replace(/\P{Letter}/gu, '').toLowerCase());
				const songName = hiraganize(songInfo.title.replace(/\P{Letter}/gu, '').toLowerCase());
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());

				const distance1 = levenshtein.get(answer, userAnswer);
				const distance2 = levenshtein.get(songName, userAnswer);

				if (distance1 <= answer.length / 3 || distance2 <= songName.length / 3) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `<@${message.user}> 正解:tada:\n答えは ＊${songInfo.title}＊ (${state.answer} ${songInfo.type}) だよ:muscle:\n\n${songInfo.movie}`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: songInfo.utaNetUrl,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						unfurl_links: true,
					});

					const {animeInfos} = await loadSheet();
					const animeInfo = animeInfos.find(({name}) => name === state.answer);
					await increment(message.user, 'anime-song-answer');
					if (state.hints.length === 1) {
						await increment(message.user, 'anime-song-answer-first-hint');
					}
					if (state.hints.length <= 2) {
						await unlock(message.user, 'anime-song-answer-second-hint');
					}
					if (state.hints.length <= 3) {
						await unlock(message.user, 'anime-song-answer-third-hint');
					}
					if (state.difficulty === 'hard') {
						await unlock(message.user, 'anime-song-hard-answer');
					}
					if (animeInfo && animeInfo.year < 2010) {
						await unlock(message.user, 'anime-song-before-2010');
					}

					state.answer = null;
					state.previousHint = 0;
					state.hints = [];
					state.thread = null;
					state.difficulty = null;
				} else {
					await slack.reactions.add({
						name: 'no_good',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			});
		}
	});
};
