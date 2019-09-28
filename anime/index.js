const cloudinary = require('cloudinary');
const {random, sum, sample, uniq} = require('lodash');
const fs = require('fs-extra');
const levenshtein = require('fast-levenshtein');
const {google} = require('googleapis');
// const {xml2js} = require('xml-js');
// const axios = require('axios');
const {Deferred} = require('../lib/utils.ts');

const animesDeferred = new Deferred();

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
	console.log(thumbs);
	const thumb = sample(thumbs);
	const imageData = await fs.readFile(`../slackbot-anime-thumber/webp/${video.type}/${video.id}/${thumb}`);
	return imageData;
};

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	let answer = null;

	rtm.on('message', async (message) => {
		if (message.text === 'アニメ当てクイズ' && answer === null) {
			if (!animesDeferred.isResolved) {
				loadSheet();
			}
			const animes = await animesDeferred.promise;
			const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));
			answer = sample(animeTitles);

			const imageData = await getRandomThumb(answer);

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
			console.log({cloudinaryDatum});

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: 'このアニメなーんだ',
				username: 'anime',
				icon_emoji: ':japan:',
				attachments: [{
					image_url: cloudinaryDatum.secure_url.replace(/\.webp$/, '.png'),
					fallback: 'このアニメなーんだ',
				}],
			});
			return;
		}

		if (message.text === '@anime ヒント' && answer !== null) {
			const imageData = await getRandomThumb(answer);

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
			console.log({cloudinaryDatum});

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: 'もう、しょうがないにゃあ',
				username: 'anime',
				icon_emoji: ':japan:',
				attachments: [{
					image_url: cloudinaryDatum.secure_url.replace(/\.webp$/, '.png'),
					fallback: 'もう、しょうがないにゃあ',
				}],
			});
			return;
		}

		if (message.text === '@anime わからん' && answer !== null) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:ha:\n答えは＊${answer}＊だよ:anger:\nこれくらい常識だよね?`,
				username: 'anime',
				icon_emoji: ':japan:',
			});
			answer = null;
			return;
		}

		if (answer !== null && message.text) {
			const distance = levenshtein.get(
				answer.replace(/\P{Letter}/gu, '').toLowerCase(),
				message.text.replace(/\P{Letter}/gu, '').toLowerCase(),
			);
			console.log(answer, message.text, distance);

			if (distance <= answer.length / 3) {
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: `<@${message.user}> 正解:tada:\n答えは＊${answer}＊だよ:muscle:`,
					username: 'anime',
					icon_emoji: ':japan:',
				});
				answer = null;
			}
		}
	});
};
