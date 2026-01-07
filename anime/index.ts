import {Mutex} from 'async-mutex';
import axios from 'axios';
import cloudinary from 'cloudinary';
import {stripIndent} from 'common-tags';
import levenshtein from 'fast-levenshtein';
import {google} from 'googleapis';
// @ts-expect-error: Missing types
import {hiraganize} from 'japanese';
import {get, last, minBy, random, sum, sample, uniq, groupBy, mapValues, range, flatten} from 'lodash';
import {xml2js} from 'xml-js';
import {unlock, increment} from '../achievements';
import {Deferred} from '../lib/utils';
import type {GenericMessageEvent} from '@slack/web-api';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {SlackInterface} from '../lib/slack';

const animesDeferred = new Deferred<AnimeData>();
const mutex = new Mutex();

interface VideoData {
	type: string;
	id: string;
	title: string;
	channel: string;
	animeTitle: string;
	count: number;
}

interface AnimeInfo {
	name: string;
	longName: string;
	reading: string;
	date: string;
	rank: number;
	point: number;
	url: string;
	year: number | null;
	utanetId: string;
}

interface AnimeData {
	animes: VideoData[];
	easyAnimes: string[];
	normalAnimes: string[];
	animeByYears: Record<string, string[]>;
	animeInfos: AnimeInfo[];
}

interface HintData {
	publicId: string;
	video: VideoData;
	filename: string;
}

const loadSheet = async (): Promise<AnimeData> => {
	if (animesDeferred.isResolved) {
		return animesDeferred.promise;
	}

	const auth = new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	});
	const sheets = google.sheets({version: 'v4', auth});

	const {data: {values}} = await new Promise<any>((resolve, reject) => {
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
	const animes = values.slice(1).map(([type, id, title, channel, animeTitle, count]: string[]) => ({
		type, id, title, channel, animeTitle, count: parseInt(count),
	}));

	const {data: {values: animeInfoData}} = await new Promise<any>((resolve, reject) => {
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
	const animeInfos = animeInfoData.map(([name, longName, reading, date, rank, point, url, utanetId]: string[]) => ({
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
		...animeInfos.filter(({rank, year}) => rank <= 100 && year !== null && year >= 2005).map(({name}) => name),
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

const getUrl = (publicId: string, options: any = {}) => (
	cloudinary.v2.url(`${publicId}.jpg`, {
		private_cdn: false,
		secure: true,
		secure_distribution: 'res.cloudinary.com',
		...options,
	})
);

const getRandomThumb = async (answer: string): Promise<{publicId: string; video: VideoData; filename: string}> => {
	const {animes} = await animesDeferred.promise;
	const videos = animes.filter(({animeTitle}) => animeTitle === answer);
	const totalThumbs = sum(videos.map(({count}) => count));
	const thumbIndex = random(totalThumbs);
	let offset = 0;
	const video = videos.find(({count}) => {
		offset += count;
		return thumbIndex < offset;
	})!;

	const {data: filesXml} = await axios.get('https://hakata-thumbs.s3.amazonaws.com/', {
		params: {
			'list-type': 2,
			prefix: `${video.type}/${video.id}/`,
		},
	});
	const filesData = get(xml2js(filesXml, {compact: true}), ['ListBucketResult', 'Contents'], []);
	const filePath = get(sample(filesData), ['Key', '_text'], '');
	const {data: imageData} = await axios.get(`https://hakata-thumbs.s3.amazonaws.com/${filePath}`, {responseType: 'arraybuffer'});

	const cloudinaryDatum = await new Promise<any>((resolve, reject) => {
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

	return {publicId: cloudinaryDatum.public_id, video, filename: last(filePath.split('/'))!};
};

const getUnitTime = (type: string) => {
	if (type === 'niconico' || type === 'gyao') {
		return 15;
	}
	return 30;
};

const getVideoInfo = (video: VideoData, filename: string) => {
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

const getHintText = (n: number) => {
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

const getHintOptions = (n: number, difficulty: string) => {
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

interface QuizState {
	answer: string | null;
	previousTick: number;
	previousHint: number;
	hints: HintData[];
	thread: string | null;
	difficulty: string | null;
	channel: string | null;
}

class AnimeQuizBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^(?:アニメ当てクイズ(?:easy|normal|hard|extreme)?|@anime)/u;

	protected override readonly username = 'anime';

	protected override readonly iconEmoji = ':tv:';

	private state: QuizState = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
		thread: null,
		difficulty: null,
		channel: null,
	};

	private intervalId: NodeJS.Timeout | null = null;

	constructor(
		protected readonly slackClients: SlackInterface,
	) {
		super(slackClients);
		this.startTicker();
	}

	private startTicker() {
		this.intervalId = setInterval(() => {
			this.onTick();
		}, 1000);
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
						channel: this.state.channel!,
						text: hintText,
						thread_ts: this.state.thread!,
						attachments: [{
							image_url: getUrl(publicId, getHintOptions(this.state.hints.length, this.state.difficulty!)),
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
						channel: this.state.channel!,
						text: `もう、しっかりして！\n答えは＊${this.state.answer}＊だよ:anger:\n${anger}`,
						thread_ts: this.state.thread!,
						reply_broadcast: true,
					});
					await this.postMessage({
						channel: this.state.channel!,
						text: '今回のヒント一覧だよ:anger:',
						thread_ts: this.state.thread!,
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

					await this.deleteProgressMessage(this.state.thread!);

					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hints = [];
					this.state.thread = null;
					this.state.difficulty = null;
					this.state.channel = null;
				}
			}
			this.state.previousTick = now;
		});
	}

	protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		const quizMessageDeferred = new Deferred<string | null>();

		if (message.text.startsWith('@anime') && this.state.answer === null) {
			// Handle @anime lookup
			mutex.runExclusive(async () => {
				if (!animesDeferred.isResolved) {
					loadSheet();
				}
				const {animes, easyAnimes, normalAnimes, animeByYears, animeInfos} = await animesDeferred.promise;
				const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));

				const requestedTitle = hiraganize((message.text as string).replace('@anime', '').replace(/\P{Letter}/gu, '').toLowerCase());
				const animeTitle = minBy(animeTitles, (title) => (
					levenshtein.get(requestedTitle, hiraganize(title.replace(/\P{Letter}/gu, '').toLowerCase()))
				));

				const {publicId, video, filename} = await getRandomThumb(animeTitle!);
				const info = getVideoInfo(video, filename);
				const animeInfo = animeInfos.find(({name}) => name === animeTitle);
				if (animeInfo === undefined || animeInfo.year === null) {
					await this.postMessage({
						channel,
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
					quizMessageDeferred.resolve(null);
					return;
				}
				const yearRank = animeByYears[animeInfo.year.toString()].findIndex((name) => name === animeTitle);
				const yearTotal = animeByYears[animeInfo.year.toString()].length;
				const difficulty = (easyAnimes.includes(animeTitle!) ? 'easy' : (normalAnimes.includes(animeTitle!) ? 'normal' : 'hard'));

				await this.postMessage({
					channel,
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
				quizMessageDeferred.resolve(null);
			}).catch((error: unknown) => {
				this.log.error('Failed to lookup anime', error);
				const errorText =
					error instanceof Error && error.stack !== undefined
						? error.stack : String(error);
				this.postMessage({
					channel,
					text: `エラー😢\n\`${errorText}\``,
				});
				quizMessageDeferred.resolve(null);
			});
			return quizMessageDeferred.promise;
		}

		// Handle quiz start
		const matches = (message.text as string).match(/^アニメ当てクイズ(?<difficulty>easy|normal|hard|extreme)?$/);
		if (matches && this.state.answer === null) {
			const difficulty = matches.groups?.difficulty || 'normal';

			mutex.runExclusive(async () => {
				const {animes, easyAnimes, normalAnimes} = await loadSheet();
				const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));
				let answer: string | undefined = undefined;
				if (difficulty === 'easy' || difficulty === 'extreme') {
					answer = sample(easyAnimes);
				} else if (difficulty === 'normal') {
					answer = sample(normalAnimes);
				} else {
					answer = sample(animeTitles);
				}

				const {publicId, video, filename} = await getRandomThumb(answer!);

				const {ts} = await this.postMessage({
					channel,
					text: 'このアニメなーんだ',
					attachments: [{
						image_url: getUrl(publicId, getHintOptions(0, difficulty)),
						fallback: 'このアニメなーんだ',
					}],
				});

				this.state.thread = ts!;
				this.state.channel = channel;
				this.state.hints.push({publicId, video, filename});
				this.state.previousHint = Date.now();
				this.state.difficulty = difficulty;

				await this.postMessage({
					channel,
					text: '15秒経過でヒントを出すよ♫',
					thread_ts: ts!,
				});

				this.state.answer = answer!;
				quizMessageDeferred.resolve(ts!);
			}).catch((error: unknown) => {
				this.log.error('Failed to start anime quiz', error);
				const errorText =
					error instanceof Error && error.stack !== undefined
						? error.stack : String(error);
				this.postMessage({
					channel,
					text: `エラー😢\n\`${errorText}\``,
				});
				quizMessageDeferred.resolve(null);
			});

			return quizMessageDeferred.promise;
		}

		quizMessageDeferred.resolve(null);
		return quizMessageDeferred.promise;
	}

	protected override async onMessageEvent(event: any) {
		// Call parent method to handle wake word detection
		await super.onMessageEvent(event);

		// Handle answers in thread
		const message = event;
		if (this.state.answer !== null && message.text && message.thread_ts === this.state.thread && message.username !== 'anime') {
			mutex.runExclusive(async () => {
				if (this.state.answer === null) {
					return;
				}

				const answer = hiraganize(this.state.answer.replace(/\P{Letter}/gu, '').toLowerCase());
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());

				const distance = levenshtein.get(answer, userAnswer);

				if (distance <= answer.length / 3) {
					await this.postMessage({
						channel: this.state.channel!,
						text: `<@${message.user}> 正解:tada:\n答えは＊${this.state.answer}＊だよ:muscle:`,
						thread_ts: this.state.thread!,
						reply_broadcast: true,
					});
					await this.postMessage({
						channel: this.state.channel!,
						text: '今回のヒント一覧だよ',
						thread_ts: this.state.thread!,
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
					if (animeInfo && animeInfo.year !== null && animeInfo.year < 2010) {
						await unlock(message.user, 'anime-before-2010');
					}
					if (animeInfo && animeInfo.year !== null && animeInfo.year < 2000) {
						await unlock(message.user, 'anime-before-2000');
					}

					await this.deleteProgressMessage(this.state.thread!);

					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hints = [];
					this.state.thread = null;
					this.state.difficulty = null;
					this.state.channel = null;
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

export default function animeQuiz(slackClients: SlackInterface) {
	return new AnimeQuizBot(slackClients);
}

export {loadSheet};
