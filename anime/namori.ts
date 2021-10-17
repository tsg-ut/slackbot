import type {ImageBlock, MrkdwnElement} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import cloudinary from 'cloudinary';
import type {CommonTransformationOptions} from 'cloudinary';
// @ts-expect-error
import {hiraganize} from 'japanese';
import {random, sample, range} from 'lodash';
import {increment} from '../achievements';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';

const mutex = new Mutex();

interface CharacterData {
	tweetId: string,
	mediaId: string,
	imageUrl: string,
	characterName: string,
	workName: string,
	validAnswers: string[],
}

interface LocalState {
	answer: CharacterData,
	previousTick: number,
	previousHint: number,
	hints: number,
	thread: string,
	image: {
		imageId: string,
		width: number,
		height: number,
	},
}

interface PersistentState {
	recentMediaIds: string[],
}

const loader = new Loader<CharacterData[]>(async () => {
	const {data} = await axios.get<string>('https://github.com/hakatashi/namori_rakugaki_animation/raw/master/namori.csv');
	const lines = data.split('\n').slice(1).filter((line) => line.length > 0);
	return lines.map((line) => {
		const [tweetId, mediaId, imageUrl, characterName, characterRuby, workName] = line.split(',');
		const characterNames = characterName.split('、');
		const characterRubys = characterRuby.split('、');

		const names = [...characterNames, ...characterRubys];
		const namePartsList = names.map((name) => name.split(' '));

		return {
			tweetId,
			mediaId,
			imageUrl,
			characterName: characterNames[0].replace(/ /g, ''),
			workName,
			validAnswers: [
				...namePartsList.map((parts) => parts.join('')),
				...namePartsList.flat(),
			],
		} as CharacterData;
	});
});

const getUrl = (publicId: string, options = {}) => (
	cloudinary.v2.url(`${publicId}.jpg`, {
		private_cdn: false,
		secure: true,
		secure_distribution: 'res.cloudinary.com',
		...options,
	})
);

const uploadImage = async (url: string) => {
	const {data: imageData} = await axios.get<Buffer>(url, {responseType: 'arraybuffer'});

	const cloudinaryDatum = await new Promise<cloudinary.UploadApiResponse>((resolve, reject) => {
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

	return {
		imageId: cloudinaryDatum.public_id,
		width: cloudinaryDatum.width,
		height: cloudinaryDatum.height,
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

const getHintOptions = ({width, height}: {width: number, height: number}, n: number): CommonTransformationOptions => {
	if (n <= 0) {
		const newHeight = Math.floor(width / 100);
		return {
			transformation: [
				{
					width,
					height: newHeight,
					crop: 'crop',
					y: random(height - newHeight),
				},
			],
		};
	}
	if (n <= 1) {
		const newSize = 20;
		return {
			transformation: [
				{
					width: newSize,
					height: newSize,
					x: random(width - newSize),
					y: random(height - newSize),
					crop: 'crop',
				},
			],
		};
	}
	if (n <= 2) {
		const newSize = 200;
		return {
			transformation: [
				{
					effect: 'pixelate:10',
					width: newSize,
					height: newSize,
					x: random(width - newSize),
					y: random(height - newSize),
					crop: 'crop',
				},
			],
		};
	}
	if (n <= 3) {
		const newSize = 200;
		return {
			transformation: [
				{
					width: newSize,
					height: newSize,
					x: random(width - newSize),
					y: random(height - newSize),
					crop: 'crop',
				},
			],
		};
	}
	const newHeight = Math.floor(width / 2);
	return {
		transformation: [
			{
				width,
				height: newHeight,
				crop: 'crop',
				y: random(height - newHeight),
			},
		],
	};
};

module.exports = async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const state: LocalState = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: 0,
		thread: null,
		image: null,
	};

	const persistentState = await State.init<PersistentState>('anime-namori', {
		recentMediaIds: [],
	});

	const onTick = () => {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = state.previousHint + (state.hints === 5 ? 30 : 15) * 1000;

			if (state.answer !== null && nextHint <= now) {
				state.previousHint = now;
				if (state.hints < 5) {
					const hintText = getHintText(state.hints);

					const hintBlocks = state.hints === 1
						? range(3).map(() => ({
							type: 'context',
							elements: range(10).map(() => ({
								type: 'image',
								image_url: getUrl(state.image.imageId, getHintOptions(state.image, 1)),
								alt_text: hintText,
							} as ImageBlock)),
						}))
						: [{
							type: 'image',
							block_id: 'image',
							image_url: getUrl(state.image.imageId, getHintOptions(state.image, state.hints)),
							alt_text: hintText,
						}];

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: hintText,
						username: 'namori',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'plain_text',
									text: hintText,
									emoji: true,
								},
							},
							...hintBlocks,
						],
					});

					state.hints++;
				} else {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `もう、しっかりして！\n答えは＊${state.answer.characterName}＊ (${state.answer.workName}) だよ:anger:`,
						username: 'namori',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
					});

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: state.answer.characterName,
						username: 'namori',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						unfurl_links: true,
						unfurl_media: true,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `https://twitter.com/_namori_/status/${state.answer.tweetId}`,
								} as MrkdwnElement,
							},
							{
								type: 'image',
								block_id: 'image',
								image_url: getUrl(state.image.imageId, {}),
								alt_text: state.answer.characterName,
							},
						],
					});

					state.answer = null;
					state.previousHint = 0;
					state.hints = 0;
					state.thread = null;
					state.image = null;
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

		if (message.text && message.text === 'なもり当てクイズ' && state.answer === null) {
			mutex.runExclusive(async () => {
				const characters = await loader.load();
				const candidateCharacters = characters.filter((character) => (
					!persistentState.recentMediaIds.includes(character.mediaId)
				));
				const answer = sample(candidateCharacters);

				const image = await uploadImage(answer.imageUrl);

				const result = await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: 'このキャラだーれだ',
					username: 'anime',
					icon_emoji: ':tv:',
					blocks: [
						{
							type: 'section',
							text: {
								type: 'plain_text',
								text: 'このキャラだーれだ',
								emoji: true,
							},
						},
						{
							type: 'image',
							block_id: 'image',
							image_url: getUrl(image.imageId, getHintOptions(image, 0)),
							alt_text: 'このキャラだーれだ',
						},
					],
				});

				state.thread = result.ts as string;
				state.previousHint = Date.now();
				state.image = image;
				state.hints = 1;

				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '15秒経過でヒントを出すよ♫',
					username: 'namori',
					icon_emoji: ':tv:',
					thread_ts: result.ts as string,
				});

				state.answer = answer;
				persistentState.recentMediaIds.push(answer.mediaId);
				while (persistentState.recentMediaIds.length > 50) {
					persistentState.recentMediaIds.shift();
				}
			});
		}

		if (state.answer !== null && message.text && message.thread_ts === state.thread && message.username !== 'namori') {
			mutex.runExclusive(async () => {
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());
				const isCorrect = state.answer.validAnswers.some((rawAnswer) => {
					const answer = hiraganize(rawAnswer.replace(/\P{Letter}/gu, '').toLowerCase());
					return userAnswer === answer;
				});

				if (isCorrect) {
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: `<@${message.user}> 正解:tada:\n答えは＊${state.answer.characterName}＊ (${state.answer.workName}) だよ:muscle:`,
						username: 'namori',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						reply_broadcast: true,
					});

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: state.answer.characterName,
						username: 'namori',
						icon_emoji: ':tv:',
						thread_ts: state.thread,
						unfurl_links: true,
						unfurl_media: true,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `https://twitter.com/_namori_/status/${state.answer.tweetId}`,
								} as MrkdwnElement,
							},
							{
								type: 'image',
								block_id: 'image',
								image_url: getUrl(state.image.imageId, {}),
								alt_text: state.answer.characterName,
							},
						],
					});

					await increment(message.user, 'namori-answer');
					if (state.hints === 1) {
						await increment(message.user, 'namori-answer-first-hint');
					}
					if (state.hints <= 2) {
						await increment(message.user, 'namori-answer-second-hint');
					}
					if (state.hints <= 3) {
						await increment(message.user, 'namori-answer-third-hint');
					}

					state.answer = null;
					state.previousHint = 0;
					state.hints = 0;
					state.thread = null;
					state.image = null;
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
