import {Mutex} from 'async-mutex';
import axios from 'axios';
import cloudinary from 'cloudinary';
import {stripIndent} from 'common-tags';
import levenshtein from 'fast-levenshtein';
import {google} from 'googleapis';
import {hiraganize} from 'japanese';
import {promises as fs} from 'fs';
import path from 'path';
import {get, last, minBy, random, sum, sample, uniq, groupBy, mapValues, range, flatten, escapeRegExp, sampleSize, chunk, sortBy, shuffle} from 'lodash';
import {xml2js} from 'xml-js';
import {unlock, increment} from '../achievements';
import {tokenize} from 'kuromojin';
import scrapeIt from 'scrape-it';
import {getSongInfo, getMovieInfo} from '../lyrics';
import {Deferred} from '../lib/utils';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {SlackInterface} from '../lib/slack';

const animesDeferred = new Deferred();
const mutex = new Mutex();

const loadSheet = async () => {
	if (animesDeferred.isResolved) {
		return animesDeferred.promise;
	}

	const auth = new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	});
	const sheets = google.sheets({version: 'v4', auth});

	const {data: {values}} = await new Promise((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: '12YLDm-YqzWO3kL0ehZPKr9zF5WbYwLj31B_XsRIPb58',
			range: 'A:F',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else {
				resolve(response);
			}
		});
	});
	const animes = values.slice(1).map(([type, id, title, channel, animeTitle, count]) => ({
		type, id, title, channel, animeTitle, count: parseInt(count),
	}));

	const {data: {values: animeInfoData}} = await new Promise((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: '12YLDm-YqzWO3kL0ehZPKr9zF5WbYwLj31B_XsRIPb58',
			range: 'animes!A:H',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else {
				resolve(response);
			}
		});
	});
	const animeInfos = animeInfoData.map(([name, longName, reading, date, rank, point, url, utanetId]) => ({
		name,
		longName,
		reading,
		date,
		rank: parseInt(rank),
		point: parseFloat(point),
		url,
		year: date ? parseInt(date.split('/')[0]) : null,
		utanetId,
	}));
	const animeByYears = mapValues(
		groupBy(animeInfos, ({year}) => year),
		(year) => year.sort((a, b) => a.rank - b.rank).map(({name}) => name),
	);
	const easyAnimes = uniq([
		...animeInfos.filter(({rank, year}) => rank <= 100 && year >= 2005).map(({name}) => name),
		...flatten(
			range(2010, 2020).map((year) => (
				animeByYears[year.toString()].slice(0, 20)
			)),
		),
	]);
	const normalAnimes = uniq([
		...animeInfos.filter(({rank}) => rank <= 150).map(({name}) => name),
		...flatten(
			range(2015, 2020).map((year) => (
				animeByYears[year.toString()]
			)),
		),
		...flatten(
			range(2010, 2015).map((year) => (
				animeByYears[year.toString()].slice(0, 40)
			)),
		),
		...flatten(
			range(2000, 2010).map((year) => (
				animeByYears[year.toString()].slice(0, 20)
			)),
		),
	]);

	animesDeferred.resolve({animes, easyAnimes, normalAnimes, animeByYears, animeInfos});
	return animesDeferred.promise;
};

const getUrl = (publicId, options = {}) => (
	cloudinary.url(`${publicId}.jpg`, {
		private_cdn: false,
		secure: true,
		secure_distribution: 'res.cloudinary.com',
		...options,
	})
);

const getRandomThumb = async (answer) => {
	const {animes} = await animesDeferred.promise;
	const videos = animes.filter(({animeTitle}) => animeTitle === answer);
	const totalThumbs = sum(videos.map(({count}) => count));
	const thumbIndex = random(totalThumbs);
	let offset = 0;
	const video = videos.find(({count}) => {
		offset += count;
		return thumbIndex < offset;
	});

	const {data: filesXml} = await axios.get('https://hakata-thumbs.s3.amazonaws.com/', {
		params: {
			'list-type': 2,
			prefix: `${video.type}/${video.id}/`,
		},
	});
	const filesData = get(xml2js(filesXml, {compact: true}), ['ListBucketResult', 'Contents'], []);
	const filePath = get(sample(filesData), ['Key', '_text'], '');
	const {data: imageData} = await axios.get(`https://hakata-thumbs.s3.amazonaws.com/${filePath}`, {responseType: 'arraybuffer'});

	const cloudinaryDatum = await new Promise((resolve, reject) => {
		cloudinary.v2.uploader
			.upload_stream({resource_type: 'image'}, (error, data) => {
				if (error) {
					reject(error);
				} else {
					resolve(data);
				}
			})
			.end(imageData);
	});

	return {publicId: cloudinaryDatum.public_id, video, filename: last(filePath.split('/'))};
};

const getUnitTime = (type) => {
	if (type === 'niconico' || type === 'gyao') {
		return 15;
	}
	return 30;
};

const getVideoInfo = (video, filename) => {
	const fileIndex = parseInt(filename.split('.')[0]);
	const seekTime = Math.floor((fileIndex + 0.5) * getUnitTime(video.type));
	const hours = Math.floor(seekTime / 60 / 60);
	const minutes = Math.floor(seekTime / 60) % 60;
	const seconds = seekTime % 60;
	const timeText = hours === 0 ? `${minutes}分${seconds}秒～` : `${hours}時間${minutes}分${seconds}秒～`;

	if (video.type === 'lives') {
		return {
			title: `${video.title} (${timeText}) - ニコニコ生放送`,
			url: `https://live.nicovideo.jp/gate/${video.id}`,
		};
	}

	if (video.type === 'niconico') {
		return {
			title: `${video.title} (${timeText}) - ニコニコ動画`,
			url: `https://www.nicovideo.jp/watch/${video.id}?from=${seekTime}`,
		};
	}

	if (video.type === 'youtube') {
		return {
			title: `${video.title} (${timeText}) - YouTube`,
			url: `https://www.youtube.com/watch?v=${video.id}&t=${seekTime}`,
		};
	}

	if (video.type === 'gyao') {
		return {
			title: `${video.title} (${timeText}) - GYAO!`,
			url: 'https://gyao.yahoo.co.jp/',
		};
	}

	return {
		title: '',
		url: '',
	};
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

const getHintOptions = (n, difficulty) => {
	if (difficulty === 'extreme') {
		if (n <= 0) {
			return {
				transformation: [
					{width: 150},
					{effect: 'pixelate:30'},
				],
			};
		}
		if (n <= 1) {
			return {
				transformation: [
					{effect: 'pixelate:40'},
				],
			};
		}
		if (n <= 2) {
			return {
				transformation: [
					{effect: 'pixelate:30'},
				],
			};
		}
		if (n <= 3) {
			return {
				transformation: [
					{effect: 'pixelate:25'},
				],
			};
		}
		return {
			transformation: [
				{effect: 'pixelate:20'},
			],
		};
	}
	if (n <= 0) {
		return {
			transformation: [
				{width: 150},
				{effect: 'pixelate:6'},
			],
		};
	}
	if (n <= 1) {
		return {
			transformation: [
				{effect: 'pixelate:8'},
			],
		};
	}
	return {};
};

class AnimeBot extends ChannelLimitedBot {
	private state = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
		thread: null,
		difficulty: null,
	};

	constructor(slackClients: SlackInterface) {
		super(slackClients);
		this.allowedChannels = [process.env.CHANNEL_SANDBOX, process.env.CHANNEL_TSGBOT_GAMES];
		this.wakeWordRegex = /^アニメ当てクイズ(?<difficulty>easy|normal|hard|extreme)?$/;
		this.name = 'anime';
		this.icon = ':tv:';
		setInterval(this.onTick.bind(this), 1000);
	}

	private onTick() {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = this.state.previousHint + (this.state.hints.length === 5 ? 30 : 15) * 1000;

			if (this.state.answer !== null && nextHint <= now) {
				this.state.previousHint = now;
				if (this.state.hints.length < 5) {
					const {publicId, video, filename} = await getRandomThumb(this.state.answer);
					const hintText = getHintText(this.state.hints.length);

					await this.postMessage({
						channel: this.state.thread.channel,
						text: hintText,
						thread_ts: this.state.thread.ts,
						attachments: [{
							image_url: getUrl(publicId, getHintOptions(this.state.hints.length, this.state.difficulty)),
							fallback: hintText,
						}],
					});

					this.state.hints.push({publicId, video, filename});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
					]);
					await this.postMessage({
						channel: this.state.thread.channel,
						text: `もう、しっかりして！\n答えは＊${this.state.answer}＊だよ:anger:\n${anger}`,
						thread_ts: this.state.thread.ts,
						reply_broadcast: true,
					});
					await this.postMessage({
						channel: this.state.thread.channel,
						text: '今回のヒント一覧だよ:anger:',
						thread_ts: this.state.thread.ts,
						attachments: this.state.hints.map((hint) => {
							const info = getVideoInfo(hint.video, hint.filename);
							return {
								title: info.title,
								title_link: info.url,
								image_url: getUrl(hint.publicId),
								fallback: info.title,
							};
						}),
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

	protected override async onWakeWord(event: GenericMessageEvent, channel: string) {
		const difficulty = event.text.match(this.wakeWordRegex)!.groups!.difficulty || 'normal';

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

			const {publicId, video, filename} = await getRandomThumb(answer);

			const {ts, channel} = await this.postMessage({
				channel,
				text: 'このアニメなーんだ',
				attachments: [{
					image_url: getUrl(publicId, getHintOptions(0, difficulty)),
					fallback: 'このアニメなーんだ',
				}],
			});

			this.state.thread = {ts, channel};
			this.state.hints.push({publicId, video, filename});
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

	protected override async onMessageEvent(message: MessageEvent) {
		await super.onMessageEvent(message);

		if (message.text && message.text.startsWith('@anime') && this.state.answer === null) {
			mutex.runExclusive(async () => {
				if (!animesDeferred.isResolved) {
					loadSheet();
				}
				const {animes, easyAnimes, normalAnimes, animeByYears, animeInfos} = await animesDeferred.promise;
				const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));

				const requestedTitle = hiraganize(message.text.replace('@anime', '').replace(/\P{Letter}/gu, '').toLowerCase());
				const animeTitle = minBy(animeTitles, (title) => (
					levenshtein.get(requestedTitle, hiraganize(title.replace(/\P{Letter}/gu, '').toLowerCase()))
				));

				const {publicId, video, filename} = await getRandomThumb(animeTitle);
				const info = getVideoInfo(video, filename);
				const animeInfo = animeInfos.find(({name}) => name === animeTitle);
				if (animeInfo === undefined || animeInfo.year === null) {
					await this.postMessage({
						channel: message.channel,
						text: stripIndent`
						＊${animeTitle}＊はこんなアニメだよ！
						＊出題範囲＊ hard
					`,
						attachments: [{
							title: info.title,
							title_link: info.url,
							image_url: getUrl(publicId),
							fallback: info.title,
						}],
					});
					return;
				}
				const yearRank = animeByYears[animeInfo.year.toString()].findIndex((name) => name === animeTitle);
				const yearTotal = animeByYears[animeInfo.year.toString()].length;
				// eslint-disable-next-line no-nested-ternary
				const difficulty = (easyAnimes.includes(animeTitle) ? 'easy' : (normalAnimes.includes(animeTitle) ? 'normal' : 'hard'));

				await this.postMessage({
					channel: message.channel,
					text: stripIndent`
						＊${animeTitle}＊はこんなアニメだよ！
						＊総合ランキング＊ ${animeInfo.rank}位 ＊年度別ランキング＊ ${yearRank + 1}/${yearTotal}位
						＊放送開始日＊ ${animeInfo.date} ＊出題範囲＊ ${difficulty}
					`,
					attachments: [{
						title: info.title,
						title_link: info.url,
						image_url: getUrl(publicId),
						fallback: info.title,
					}],
				});
			});
		}

		if (this.state.answer !== null && message.text && message.thread_ts === this.state.thread.ts && message.username !== 'anime') {
			mutex.runExclusive(async () => {
				const answer = hiraganize(this.state.answer.replace(/\P{Letter}/gu, '').toLowerCase());
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());

				const distance = levenshtein.get(answer, userAnswer);

				if (distance <= answer.length / 3) {
					await this.postMessage({
						channel: message.channel,
						text: `<@${message.user}> 正解:tada:\n答えは＊${this.state.answer}＊だよ:muscle:`,
						thread_ts: this.state.thread.ts,
						reply_broadcast: true,
					});
					await this.postMessage({
						channel: message.channel,
						text: '今回のヒント一覧だよ',
						thread_ts: this.state.thread.ts,
						attachments: this.state.hints.map((hint) => {
							const info = getVideoInfo(hint.video, hint.filename);
							return {
								title: info.title,
								title_link: info.url,
								image_url: getUrl(hint.publicId),
								fallback: info.title,
							};
						}),
					});

					const {animeInfos} = await animesDeferred.promise;
					const animeInfo = animeInfos.find(({name}) => name === this.state.answer);
					await increment(message.user, 'anime-answer');
					if (this.state.hints.length === 1) {
						await increment(message.user, 'anime-answer-first-hint');
						if (this.state.difficulty === 'extreme') {
							await unlock(message.user, 'anime-extreme-answer-first-hint');
						}
					}
					if (this.state.hints.length <= 2) {
						await unlock(message.user, 'anime-answer-second-hint');
					}
					if (this.state.hints.length <= 3) {
						await unlock(message.user, 'anime-answer-third-hint');
					}
					if (animeInfo && animeInfo.year < 2010) {
						await unlock(message.user, 'anime-before-2010');
					}
					if (animeInfo && animeInfo.year < 2000) {
						await unlock(message.user, 'anime-before-2000');
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

const freqDeferred = new Deferred();

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

class AnisonBot extends ChannelLimitedBot {
	private state = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
		songInfos: [],
		thread: null,
		difficulty: null,
	};

	constructor(slackClients: SlackInterface) {
		super(slackClients);
		this.allowedChannels = [process.env.CHANNEL_SANDBOX, process.env.CHANNEL_TSGBOT_GAMES];
		this.wakeWordRegex = /^アニソン当てクイズ(?<difficulty>easy|normal|hard)?$/;
		this.name = 'anison';
		this.icon = ':musical_note:';
		setInterval(this.onTick.bind(this), 1000);
	}

	private onTick() {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = this.state.previousHint + (this.state.hints.length === 5 ? 30 : 15) * 1000;

			if (this.state.answer !== null && nextHint <= now) {
				this.state.previousHint = now;
				if (this.state.hints.length < 5) {
					const hintText = getHintText(this.state.hints.length);
					const hint = await getHint(this.state.songInfos, this.state.hints.length);

					await this.postMessage({
						channel: this.state.thread.channel,
						text: `${hintText}\n\n${hint}`,
						thread_ts: this.state.thread.ts,
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
					const songInfo = this.state.songInfos[0];
					await this.postMessage({
						channel: this.state.thread.channel,
						text: `もう、しっかりして！\n答えは ＊${songInfo.title}＊ (${this.state.answer} ${songInfo.type}) だよ:anger:\n${anger}\n\n${songInfo.movie}`,
						thread_ts: this.state.thread.ts,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await this.postMessage({
						channel: this.state.thread.channel,
						text: songInfo.utaNetUrl,
						thread_ts: this.state.thread.ts,
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

	protected override async onWakeWord(event: GenericMessageEvent, channel: string) {
		const difficulty = event.text.match(this.wakeWordRegex)!.groups!.difficulty || 'easy';

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

			const {ts, channel} = await this.postMessage({
				channel,
				text: `このアニソンなーんだ\n\n${await getHint(songInfos, 0)}`,
			});

			this.state.songInfos = songInfos;
			this.state.thread = {ts, channel};
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

	protected override async onMessageEvent(message: MessageEvent) {
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

export default function(slackClients: SlackInterface) {
	new AnimeBot(slackClients);
	new AnisonBot(slackClients);
}

module.exports.loadSheet = loadSheet;
