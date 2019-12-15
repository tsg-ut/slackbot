const cloudinary = require('cloudinary');
const {get, last, minBy, random, sum, sample, uniq, groupBy, mapValues, range, flatten} = require('lodash');
const {stripIndent} = require('common-tags');
const levenshtein = require('fast-levenshtein');
const {google} = require('googleapis');
const {Mutex} = require('async-mutex');
const {xml2js} = require('xml-js');
const axios = require('axios');
const {hiraganize} = require('japanese');
const {Deferred} = require('../lib/utils.ts');
const {unlock, increment} = require('../achievements');

const animesDeferred = new Deferred();
const mutex = new Mutex();

const loadSheet = async () => {
	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	}).getClient();
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
			range: 'animes!A:G',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else {
				resolve(response);
			}
		});
	});
	const animeInfos = animeInfoData.map(([name, longName, reading, date, rank, point, url]) => ({
		name,
		longName,
		reading,
		date,
		rank: parseInt(rank),
		point: parseFloat(point),
		url,
		year: date ? parseInt(date.split('/')[0]) : null,
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
	return animesDeferred;
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
			.upload_stream((error, data) => {
				if (error) {
					reject(error);
				} else {
					resolve(data);
				}
			}, {resource_type: 'image'})
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

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
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
					const {publicId, video, filename} = await getRandomThumb(state.answer);
					const hintText = getHintText(state.hints.length);

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: hintText,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						attachments: [{
							image_url: getUrl(publicId, getHintOptions(state.hints.length, state.difficulty)),
							fallback: hintText,
						}],
					});

					state.hints.push({publicId, video, filename});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
					]);
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `もう、しっかりして！\n答えは＊${state.answer}＊だよ:anger:\n${anger}`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
					});
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: '今回のヒント一覧だよ:anger:',
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						attachments: state.hints.map((hint) => {
							const info = getVideoInfo(hint.video, hint.filename);
							return {
								title: info.title,
								title_link: info.url,
								image_url: getUrl(hint.publicId),
								fallback: info.title,
							};
						}),
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

	rtm.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		let matches = null;

		if (message.text && (matches = message.text.match(/^アニメ当てクイズ(?<difficulty>easy|normal|hard|extreme)?$/)) && state.answer === null) {
			const difficulty = matches.groups.difficulty || 'normal';

			mutex.runExclusive(async () => {
				if (!animesDeferred.isResolved) {
					loadSheet();
				}
				const {animes, easyAnimes, normalAnimes} = await animesDeferred.promise;
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

				const {ts} = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: 'このアニメなーんだ',
					username: 'anime',
					icon_emoji: ':tv:',
					attachments: [{
						image_url: getUrl(publicId, getHintOptions(0, difficulty)),
						fallback: 'このアニメなーんだ',
					}],
				});

				state.thread = ts;
				state.hints.push({publicId, video, filename});
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

		if (message.text && message.text.startsWith('@anime') && state.answer === null) {
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
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: stripIndent`
						＊${animeTitle}＊はこんなアニメだよ！
						＊出題範囲＊ hard
					`,
						username: 'anime',
						icon_emoji: ':tv:',
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

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						＊${animeTitle}＊はこんなアニメだよ！
						＊総合ランキング＊ ${animeInfo.rank}位 ＊年度別ランキング＊ ${yearRank + 1}/${yearTotal}位
						＊放送開始日＊ ${animeInfo.date} ＊出題範囲＊ ${difficulty}
					`,
					username: 'anime',
					icon_emoji: ':tv:',
					attachments: [{
						title: info.title,
						title_link: info.url,
						image_url: getUrl(publicId),
						fallback: info.title,
					}],
				});
			});
		}

		if (state.answer !== null && message.text && message.thread_ts === state.thread && message.username !== 'anime') {
			mutex.runExclusive(async () => {
				const answer = hiraganize(state.answer.replace(/\P{Letter}/gu, '').toLowerCase());
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());

				const distance = levenshtein.get(answer, userAnswer);

				if (distance <= answer.length / 3) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `<@${message.user}> 正解:tada:\n答えは＊${state.answer}＊だよ:muscle:`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
					});
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: '今回のヒント一覧だよ',
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						attachments: state.hints.map((hint) => {
							const info = getVideoInfo(hint.video, hint.filename);
							return {
								title: info.title,
								title_link: info.url,
								image_url: getUrl(hint.publicId),
								fallback: info.title,
							};
						}),
					});

					await increment(message.user, 'anime-answer');
					if (state.hints.length === 1) {
						await increment(message.user, 'anime-answer-first-hint');
					}
					if (state.hints.length <= 2) {
						await unlock(message.user, 'anime-answer-second-hint');
					}
					if (state.hints.length <= 3) {
						await unlock(message.user, 'anime-answer-third-hint');
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
