const {promisify} = require('util');
const {katakanize, hiraganize} = require('japanese');
const path = require('path');
const qs = require('querystring');
const nodePersist = require('node-persist');
const download = require('download');
const cloudinary = require('cloudinary');
const {sample} = require('lodash');
const Queue = require('p-queue');
const getReading = require('../lib/getReading.js');
const fs = require('fs-extra');
const ThumbnailGenerator = require('video-thumbnail-generator').default;
const levenshtein = require('fast-levenshtein');

const histories = [];
const queue = new Queue({concurrency: 1});
const transaction = (func) => queue.add(func);

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	let answer = null;
	rtm.on('message', async (message) => {
		if (message.text === 'アニメ当てクイズ' && answer === null) {
			const list = await fs.readdir('Z:\\kakorokuRecorder\\video\\channel');
			answer = sample(list);
			const dir = path.join('Z:\\kakorokuRecorder\\video\\channel', answer);
			const videos = (await fs.readdir(dir)).filter((file) => file.endsWith('.flv'));
			const video = sample(videos);

			const tg = new ThumbnailGenerator({
				sourcePath: path.join('Z:\\kakorokuRecorder\\video\\channel', answer, video),
				thumbnailPath: __dirname,
			});
			const thumbnail = await tg.generateOneByPercent(10 + Math.random() * 10);
			console.log({thumbnail});

			const imageData = await fs.readFile(path.join(__dirname, thumbnail));
			console.log({imageData});
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
					image_url: cloudinaryDatum.secure_url,
					fallback: 'このアニメなーんだ',
				}],
			});
			return;
		}

		if (message.text === '@anime わからん' && answer !== null) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:ha:\n答えは *${answer}* だよ:anger:\nこれくらい常識だよね?`,
				username: 'anime',
				icon_emoji: ':japan:',
			});
			answer = null;
			return;
		}

		console.log(answer, message.text, levenshtein.get(answer || '', message.text));
		if (answer !== null && message.text && levenshtein.get(answer, message.text) <= Math.min(3, answer.length / 3)) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `<@${message.user}> 正解:tada:\n答えは *${answer}* だよ:muscle:`,
				username: 'anime',
				icon_emoji: ':japan:',
			});
			answer = null;
		}
	});
};
