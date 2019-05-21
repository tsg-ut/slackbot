const path = require('path');
const cloudinary = require('cloudinary');
const {sample} = require('lodash');
const fs = require('fs-extra');
const ThumbnailGenerator = require('video-thumbnail-generator').default;
const levenshtein = require('fast-levenshtein');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	let answer = null;
	let dir = null;
	rtm.on('message', async (message) => {
		if (message.text === 'アニメ当てクイズ' && answer === null) {
			const isLiveMode = Math.random() < 0.5;
			const basedir = isLiveMode ? 'Z:\\kakorokuRecorder\\video\\channel' : 'Z:\\Hakatanimation\\video';
			const list = await fs.readdir(basedir);
			answer = sample(list);
			dir = path.join(basedir, answer);
			const videos = (await fs.readdir(dir)).filter((file) => file.endsWith('.flv') || file.endsWith('.mp4'));
			const video = sample(videos);

			const tg = new ThumbnailGenerator({
				sourcePath: path.join(basedir, answer, video),
				thumbnailPath: __dirname,
			});
			const thumbnail = await tg.generateOneByPercent(10 + Math.random() * (isLiveMode ? 10 : 80), {
				size: '320x180',
			});
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

		if (message.text === '@anime ヒント' && answer !== null) {
			const videos = (await fs.readdir(dir)).filter((file) => file.endsWith('.flv') || file.endsWith('.mp4'));
			const video = sample(videos);

			const tg = new ThumbnailGenerator({
				sourcePath: path.join(dir, video),
				thumbnailPath: __dirname,
			});
			const thumbnail = await tg.generateOneByPercent(10 + Math.random() * (dir.includes('kakorokuRecorder') ? 10 : 80), {
				size: '320x180',
			});
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
				text: 'もう、しょうがないにゃあ',
				username: 'anime',
				icon_emoji: ':japan:',
				attachments: [{
					image_url: cloudinaryDatum.secure_url,
					fallback: 'もう、しょうがないにゃあ',
				}],
			});
			return;
		}

		if (message.text === '@anime わからん' && answer !== null) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:ha:\n答えは *${answer.replace(/_/g, ' ')}* だよ:anger:\nこれくらい常識だよね?`,
				username: 'anime',
				icon_emoji: ':japan:',
			});
			answer = null;
			return;
		}

		if (answer !== null && message.text) {
			const distance = levenshtein.get(answer.replace(/[_ -]/g, '').toLowerCase(), message.text.replace(/[_ -]/g, '').toLowerCase());
			console.log(answer, message.text, distance);

			if (distance <= answer.length / 3) {
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: `<@${message.user}> 正解:tada:\n答えは *${answer.replace(/_/g, ' ')}* だよ:muscle:`,
					username: 'anime',
					icon_emoji: ':japan:',
				});
				answer = null;
			}
		}
	});
};
