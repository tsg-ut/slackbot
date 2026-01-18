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
const {ChannelLimitedBot} = require('../lib/channelLimitedBot.ts');

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

class AnisonBot extends ChannelLimitedBot {
	constructor(slackClients) {
		super(slackClients);
		this.allowedChannels = [process.env.CHANNEL_SANDBOX, process.env.CHANNEL_TSGBOT_GAMES];
		this.wakeWordRegex = /^アニソン当てクイズ(?<difficulty>easy|normal|hard)?$/;
		this.name = 'anison';
		this.icon = ':musical_note:';
		this.state = {
			answer: null,
			previousTick: 0,
			previousHint: 0,
			hints: [],
			songInfos: [],
			thread: null,
			difficulty: null,
		};
		setInterval(this.onTick.bind(this), 1000);
	}

	onTick() {
		mutex.runExclusive(async () => {
			const {answer, previousHint, hints, songInfos, thread} = this.state;
			const now = Date.now();
			const nextHint = previousHint + (hints.length === 5 ? 30 : 15) * 1000;

			if (answer !== null && nextHint <= now) {
				this.state.previousHint = now;
				if (hints.length < 5) {
					const hintText = getHintText(hints.length);
					const hint = await getHint(songInfos, hints.length);

					await this.postMessage({
						channel: thread.channel,
						text: `${hintText}\n\n${hint}`,
						thread_ts: thread.ts,
					});

					this.state.hints.push({});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
					]);
					const songInfo = songInfos[0];
					await this.postMessage({
						channel: thread.channel,
						text: `もう、しっかりして！\n答えは ＊${songInfo.title}＊ (${answer} ${songInfo.type}) だよ:anger:\n${anger}\n\n${songInfo.movie}`,
						thread_ts: thread.ts,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await this.postMessage({
						channel: thread.channel,
						text: songInfo.utaNetUrl,
						thread_ts: thread.ts,
						unfurl_links: true,
					});
					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hints = [];
					this.state.thread = null;
					this.state.difficulty = null;
				}
			}
			this.state.previousTick = now;
		});
	}

	async onWakeWord(event, channel) {
		const difficulty = event.text.match(this.wakeWordRegex).groups.difficulty || 'easy';

		if (this.state.answer !== null) {
			await this.postEphemeral({
				channel,
				user: event.user,
				text: 'すでにゲームが進行中です。',
			});
			return null;
		}

		await mutex.runExclusive(async () => {
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
				await this.postMessage({
					channel,
					text: `エラー:cry:\nアニメ: ${answer}`,
				});
				return;
			}

			const {ts, channel: postedChannel} = await this.postMessage({
				channel,
				text: `このアニソンなーんだ\n\n${await getHint(songInfos, 0)}`,
			});

			this.state.songInfos = songInfos;
			this.state.thread = {ts, channel: postedChannel};
			this.state.hints.push({});
			this.state.previousHint = Date.now();
			this.state.difficulty = difficulty;

			await this.postMessage({
				channel,
				text: '15秒経過でヒントを出すよ♫',
				thread_ts: ts,
			});

			this.state.answer = answer;
		});
		return this.state.thread.ts;
	}

	async onMessageEvent(message) {
		await super.onMessageEvent(message);

		if (this.state.answer !== null && message.text && message.thread_ts === this.state.thread.ts && message.username !== 'anison') {
			mutex.runExclusive(async () => {
				if (this.state.answer === null) {
					return;
				}
				const songInfo = this.state.songInfos[0];
				const answer = hiraganize(this.state.answer.replace(/\P{Letter}/gu, '').toLowerCase());
				const songName = hiraganize(songInfo.title.replace(/\P{Letter}/gu, '').toLowerCase());
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());

				const distance1 = levenshtein.get(answer, userAnswer);
				const distance2 = levenshtein.get(songName, userAnswer);

				if (distance1 <= answer.length / 3 || distance2 <= songName.length / 3) {
					await this.postMessage({
						channel: message.channel,
						text: `<@${message.user}> 正解:tada:\n答えは ＊${songInfo.title}＊ (${this.state.answer} ${songInfo.type}) だよ:muscle:\n\n${songInfo.movie}`,
						thread_ts: this.state.thread.ts,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await this.postMessage({
						channel: message.channel,
						text: songInfo.utaNetUrl,
						thread_ts: this.state.thread.ts,
						unfurl_links: true,
					});

					const {animeInfos} = await loadSheet();
					const animeInfo = animeInfos.find(({name}) => name === this.state.answer);
					await increment(message.user, 'anime-song-answer');
					if (this.state.hints.length === 1) {
						await increment(message.user, 'anime-song-answer-first-hint');
					}
					if (this.state.hints.length <= 2) {
						await unlock(message.user, 'anime-song-answer-second-hint');
					}
					if (this.state.hints.length <= 3) {
						await unlock(message.user, 'anime-song-answer-third-hint');
					}
					if (this.state.difficulty === 'hard') {
						await unlock(message.user, 'anime-song-hard-answer');
					}
					if (animeInfo && animeInfo.year < 2010) {
						await unlock(message.user, 'anime-song-before-2010');
					}

					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hints = [];
					this.state.thread = null;
					this.state.difficulty = null;
				} else {
					await this.slack.reactions.add({
						name: 'no_good',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			});
		}
	}
}

module.exports = (slackClients) => {
	new AnisonBot(slackClients);
};
