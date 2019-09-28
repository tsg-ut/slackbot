const cloudinary = require('cloudinary');
const {random, sum, sample, uniq} = require('lodash');
const fs = require('fs-extra');
const levenshtein = require('fast-levenshtein');
const {google} = require('googleapis');
const {Mutex} = require('async-mutex');
// const {xml2js} = require('xml-js');
// const axios = require('axios');
const {Deferred} = require('../lib/utils.ts');

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
	const animes = values.map(([type, id, title, channel, animeTitle, count]) => ({
		type, id, title, channel, animeTitle, count: parseInt(count),
	}));
	animesDeferred.resolve(animes);
	return animesDeferred;
};

const getRandomThumb = async (answer) => {
	const animes = await animesDeferred.promise;
	const videos = animes.filter(({animeTitle}) => animeTitle === answer);
	const totalThumbs = sum(videos.map(({count}) => count));
	const thumbIndex = random(totalThumbs);
	let offset = 0;
	const video = videos.find(({count}) => {
		offset += count;
		return thumbIndex < offset;
	});

	/*
	const {data: filesXml} = await axios.get('https://hakata-thumbs.s3.amazonaws.com/', {
		params: {
			'list-type': 2,
			prefix: `${video.type}/${video.id}/`,
		},
	});
	const filesData = xml2js(filesXml, {compact: true});
	*/

	const thumbs = await fs.readdir(`../slackbot-anime-thumber/webp/${video.type}/${video.id}`);
	const thumb = sample(thumbs);
	const imageData = await fs.readFile(`../slackbot-anime-thumber/webp/${video.type}/${video.id}/${thumb}`);

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
	const imageUrl = cloudinaryDatum.secure_url.replace(/\.webp$/, '.png');

	return {imageUrl, video, filename: thumb};
};

const getVideoInfo = (video, filename) => {
	const fileIndex = parseInt(filename.split('.')[0]);
	const seekTime = fileIndex * 30;
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

	if (video.type === 'youtube') {
		return {
			title: `${video.title} (${timeText}) - YouTube`,
			url: `https://www.youtube.com/watch?v=${video.id}`,
		};
	}

	return {
		title: '',
		url: '',
	};
};

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
		thread: null,
	};

	const onTick = () => {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = state.previousHint + 30 * 1000;

			if (state.answer !== null && nextHint <= now) {
				state.previousHint = now;
				if (state.hints.length < 5) {
					const {imageUrl, video, filename} = await getRandomThumb(state.answer);

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: 'しょうがないにゃあ、ヒントだよ',
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						attachments: [{
							image_url: imageUrl,
							fallback: 'しょうがないにゃあ、ヒントだよ',
						}],
					});

					state.hints.push({imageUrl, video, filename});
				} else {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `もう、しっかりして！\n答えは＊${state.answer}＊だよ:anger:\nこれくらい常識だよね？`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
						attachments: state.hints.map((hint) => {
							const info = getVideoInfo(hint.video, hint.filename);
							return {
								title: info.title,
								title_link: info.url,
								image_url: hint.imageUrl,
								fallback: info.title,
							};
						}),
					});
					state.answer = null;
					state.previousHint = 0;
					state.hints = [];
					state.thread = null;
				}
			}
			state.previousTick = now;
		});
	};

	setInterval(onTick, 1000);

	rtm.on('message', (message) => {
		console.log(message, process.env.CHANNEL_SANDBOX);
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.text === 'アニメ当てクイズ' && state.answer === null) {
			mutex.runExclusive(async () => {
				if (!animesDeferred.isResolved) {
					loadSheet();
				}
				const animes = await animesDeferred.promise;
				const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));
				state.answer = sample(animeTitles);

				const {imageUrl, video, filename} = await getRandomThumb(state.answer);

				const {ts} = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: 'このアニメなーんだ',
					username: 'anime',
					icon_emoji: ':tv:',
					attachments: [{
						image_url: imageUrl,
						fallback: 'このアニメなーんだ',
					}],
				});

				state.thread = ts;
				state.hints.push({imageUrl, video, filename});
				state.previousHint = Date.now();

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '30秒経過でヒントを出すよ♫',
					username: 'anime',
					icon_emoji: ':tv:',
					thread_ts: ts,
				});
			});
		}

		if (state.answer !== null && message.text && message.thread_ts === state.thread && message.username !== 'anime') {
			mutex.runExclusive(async () => {
				const distance = levenshtein.get(
					state.answer.replace(/\P{Letter}/gu, '').toLowerCase(),
					message.text.replace(/\P{Letter}/gu, '').toLowerCase(),
				);
				console.log(state.answer, message.text, distance);

				if (distance <= state.answer.replace(/\P{Letter}/gu, '').length / 3) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `<@${message.user}> 正解:tada:\n答えは＊${state.answer}＊だよ:muscle:`,
						username: 'anime',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
						attachments: state.hints.map((hint) => {
							const info = getVideoInfo(hint.video, hint.filename);
							return {
								title: info.title,
								title_link: info.url,
								image_url: hint.imageUrl,
								fallback: info.title,
							};
						}),
					});
					state.answer = null;
					state.previousHint = 0;
					state.hints = [];
					state.thread = null;
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
