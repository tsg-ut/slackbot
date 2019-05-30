import {WebClient, RTMClient} from '@slack/client';
// @ts-ignore
import cloudinary from 'cloudinary';
// @ts-ignore
import {stripIndent} from 'common-tags';
// @ts-ignore
import {hiraganize} from 'japanese';
import {renderCrossword} from './render';
import generateCrossword from './generateCrossword';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

interface Description {
	word: string,
	description: string,
	ruby: string,
};

const wordLetters = [
	[0, 1, 2, 3],
	[4, 5, 6, 7],
	[8, 9, 10, 11],
	[12, 13, 14, 15],
	[0, 5, 10, 15],
	[3, 7, 11, 15],
	[2, 6, 10, 14],
	[1, 5, 9, 13],
	[0, 4, 8, 12],
];

const uploadImage = async (board: {color: string, letter: string}[]) => {
	const imageData = await renderCrossword(board);
	const cloudinaryData: any = await new Promise((resolve, reject) => {
		cloudinary.v2.uploader
			.upload_stream({resource_type: 'image'}, (error: any, response: any) => {
				if (error) {
					reject(error);
				} else {
					resolve(response);
				}
			})
			.end(imageData);
	});
	return cloudinaryData;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const state: {
		thread: string,
		isHolding: boolean,
		crossword: {
			words: string[],
			descriptions: Description[],
			board: string[],
		},
		board: string[],
		hitWords: string[],
		timeouts: NodeJS.Timeout[],
	} = {
		thread: null,
		isHolding: false,
		crossword: null,
		board: [],
		hitWords: [],
		timeouts: [],
	};

	rtm.on('message', async (message) => {
		if (!message.text || message.subtype || message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.thread_ts && message.thread_ts === state.thread) {
			const word = hiraganize(message.text);
			if (!state.crossword.words.includes(word) || state.hitWords.includes(word)) {
				await slack.reactions.add({
					name: 'no_good',
					channel: message.channel,
					timestamp: message.ts,
				});
				return;
			}

			const newIndices = new Set();

			for (const [index, correctWord] of state.crossword.words.entries()) {
				if (word === correctWord) {
					state.hitWords.push(word);
					for (const letterIndex of wordLetters[index]) {
						newIndices.add(letterIndex);
						state.board[letterIndex] = state.crossword.board[letterIndex];
					}
				}
			}

			if (state.board.every((cell) => cell !== null)) {
				for (const timeout of state.timeouts) {
					clearTimeout(timeout);
				}
				const cloudinaryData: any = await uploadImage(state.crossword.board.map((letter) => ({
					color: 'red',
					letter,
				})));
				state.thread = null;
				state.isHolding = false;
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						クリア！:raised_hands:
					`,
					username: 'crossword',
					icon_emoji: ':capital_abcd:',
					reply_broadcast: true,
					attachments: [{
						title: 'Cross Word',
						image_url: cloudinaryData.secure_url,
					}, ...state.crossword.descriptions.map(({word, ruby, description}, index) => ({
						text: `${index + 1}. ${word} (${ruby}): ${description}`,
					}))],
				});
			} else {
				const cloudinaryData: any = await uploadImage(state.board.map((letter, index) => (letter === null ? null : {
					color: newIndices.has(index) ? 'red' : 'black',
					letter,
				})));
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						わいわい！
					`,
					username: 'crossword',
					icon_emoji: ':capital_abcd:',
					thread_ts: state.thread,
					reply_broadcast: true,
					attachments: [{
						title: 'Cross Word',
						image_url: cloudinaryData.secure_url,
					}, ...state.crossword.descriptions.map(({description, ruby}, index) => ({
						text: `${index + 1}. ${description}`,
						ruby,
					})).filter(({ruby}) => (
						!state.hitWords.includes(ruby)
					))],
				});
			}

			return;
		}

		if (message.text.match(/^crossword$/i)) {
			if (state.isHolding) {
				return;
			}

			state.isHolding = true;
			state.board = Array(16).fill(null);
			state.hitWords = [];
			state.timeouts = [];
			const crossword = await generateCrossword();
			state.crossword = crossword;

			const cloudinaryData: any = await uploadImage(Array(16).fill(null));

			const {ts}: any = await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: stripIndent`
					楽しいクロスワードパズルを始めるよ～
					マスに入ると思う単語を90秒以内に *スレッドで* 返信してね!
				`,
				username: 'crossword',
				icon_emoji: ':capital_abcd:',
				reply_broadcast: true,
				attachments: [{
					title: 'Cross Word',
					image_url: cloudinaryData.secure_url,
				}, ...state.crossword.descriptions.map(({description}, index) => ({
					text: `${index + 1}. ${description}`,
				}))],
			});

			state.thread = ts;

			state.timeouts.push(setTimeout(async () => {
				state.thread = null;
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: '～～～～～～～～～～おわり～～～～～～～～～～',
					thread_ts: ts,
					username: 'crossword',
					icon_emoji: ':capital_abcd:',
				});
				const cloudinaryData: any = await uploadImage(state.crossword.board.map((letter, index) => ({
					color: state.board[index] === null ? 'gray' : 'black',
					letter,
				})));
				await slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					text: stripIndent`
						残念、クリアならず:cry:
					`,
					username: 'crossword',
					icon_emoji: ':capital_abcd:',
					reply_broadcast: true,
					attachments: [{
						title: 'Cross Word',
						image_url: cloudinaryData.secure_url,
					}, ...state.crossword.descriptions.map(({word, ruby, description}, index) => ({
						text: `${index + 1}. ${word} (${ruby}): ${description}`,
					}))],
				});
				state.isHolding = false;
			}, 90 * 1000));

			return;
		}
	});
};
