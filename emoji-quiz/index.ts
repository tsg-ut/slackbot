import type {MessageEvent} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import {v2 as cloudinary} from 'cloudinary';
import {sample} from 'lodash';
import sharp from 'sharp';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';

const log = logger.child({bot: 'emoji-quiz'});
const timeLimitSeconds = 60;
const PRIMARY_ICON = 'blob-thinking';
const SECONDARY_ICON = 'hugging_face';

export const getQuestions = (emoji: Record<string, string>) => {
	const resolve = (name: string): string | null => {
		const visited = new Set<string>();
		let value = emoji[name];
		while (value?.startsWith('alias:')) {
			if (visited.has(value)) {
				return null;
			}
			visited.add(value);
			value = emoji[value.slice('alias:'.length)];
		}
		return value?.match(/^https?:\/\//) ? value : null;
	};
	const questions = new Map<string, string[]>();
	for (const name of Object.keys(emoji)) {
		const url = resolve(name);
		if (url) {
			const names = questions.get(url) ?? [];
			names.push(name);
			questions.set(url, names);
		}
	}
	return Array.from(questions, ([url, names]) => ({url, names}));
};

const uploadQuestionImage = async (url: string): Promise<string> => {
	const response = await axios.get<Buffer>(url, {responseType: 'arraybuffer', timeout: 30_000});
	const image = await sharp(Buffer.from(response.data), {animated: true})
		.resize(512, 512, {fit: 'inside'})
		.toBuffer();
	return new Promise((resolve, reject) => {
		cloudinary.uploader.upload_stream((error, result) => {
			if (error) {
				reject(error);
			} else if (!result?.secure_url) {
				reject(new Error('Cloudinary did not return an image URL'));
			} else {
				resolve(result.secure_url);
			}
		}).end(image);
	});
};

export default ({eventClient, webClient}: SlackInterface) => {
	const mutex = new Mutex();
	let iconEmoji = `:${SECONDARY_ICON}:`;
	let active: {thread: string, names: string[], timer: ReturnType<typeof setTimeout>} | null = null;
	const post = (channel: string, text: string, thread?: string) => webClient.chat.postMessage({
		channel,
		username: 'emoji-quiz',
		icon_emoji: iconEmoji,
		text,
		thread_ts: thread,
		unfurl_links: false,
		unfurl_media: false,
	});

	eventClient.on('message', (message: MessageEvent) => {
		if (
			message.subtype !== undefined || !('user' in message) || !message.user ||
			('bot_id' in message && message.bot_id) ||
			message.channel !== process.env.CHANNEL_SANDBOX || !message.text
		) {
			return;
		}
		const text = message.text.trim();
		return mutex.runExclusive(async () => {
			if ('thread_ts' in message && message.thread_ts) {
				if (!active || message.thread_ts !== active.thread) {
					return;
				}
				if (active.names.includes(text)) {
					const {thread} = active;
					clearTimeout(active.timer);
					active = null;
					await post(message.channel, `<@${message.user}> 正解です。答えは ${text} :${text}: です。`, thread);
				} else {
					await post(message.channel, '不正解です。登録名をコロンなしで回答してください。', active.thread);
				}
				return;
			}
			if (text !== '絵文字当てクイズ') {
				return;
			}
			if (active) {
				await post(message.channel, 'クイズは進行中です。出題メッセージのスレッドで回答してください。');
				return;
			}
			iconEmoji = `:${SECONDARY_ICON}:`;
			try {
				const {emoji} = await webClient.emoji.list();
				iconEmoji = `:${emoji?.[PRIMARY_ICON] ? PRIMARY_ICON : SECONDARY_ICON}:`;
				const question = sample(getQuestions(emoji ?? {}));
				if (!question) {
					await post(message.channel, '出題できる絵文字がありません。');
					return;
				}
				const imageUrl = await uploadQuestionImage(question.url);
				const prompt = `この絵文字の登録名は何でしょう?\nスレッドでコロンを含めずに回答してください。制限時間は${timeLimitSeconds}秒です。`;
				const response = await webClient.chat.postMessage({
					channel: message.channel,
					username: 'emoji-quiz',
					icon_emoji: iconEmoji,
					text: prompt,
					blocks: [
						{type: 'section', text: {type: 'plain_text', text: prompt}},
						{type: 'image', image_url: imageUrl, alt_text: '出題の絵文字'},
					],
					unfurl_links: false,
					unfurl_media: false,
				});
				if (!response.ts) {
					throw new Error('Slack did not return a message timestamp');
				}
				const thread = response.ts;
				const timer = setTimeout(() => {
					mutex.runExclusive(async () => {
						if (active?.thread !== thread) {
							return;
						}
						const {names} = active;
						active = null;
						await post(message.channel, `時間切れです。答えは ${names.join(',')} です。`, thread);
					}).catch((error: unknown) => log.error('Failed to finish emoji quiz', {error}));
				}, timeLimitSeconds * 1000);
				active = {thread, names: question.names, timer};
			} catch (error) {
				log.error('Failed to start emoji quiz', {error});
				await post(message.channel, 'クイズを開始できませんでした。時間をおいて再度試してください。');
			}
		}).catch((error: unknown) => log.error('Failed to handle emoji quiz message', {error}));
	});
};
