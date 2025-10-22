import {writeFileSync} from 'fs';
import type {GenericMessageEvent} from '@slack/bolt';
import {Mutex} from 'async-mutex';
import {v2 as cloudinary} from 'cloudinary';
import {stripIndent} from 'common-tags';
import {random, sample} from 'lodash';
import QRCode, {QRCodeSegmentMode} from 'qrcode';
import toSJIS from 'qrcode/helper/to-sjis';
import sharp from 'sharp';
import {increment} from '../achievements';
import {AteQuiz, typicalMessageTextsGenerator} from '../atequiz';
// @ts-expect-error: untyped
import {getDictionary} from '../hangman';
import logger from '../lib/logger';
import {SlackInterface} from '../lib/slack';
import {Loader} from '../lib/utils';
import {getCandidateWords} from '../lib/candidateWords';

const mutex = new Mutex();

const uploadImage = async (image: Buffer): Promise<string> => {
	const response = await new Promise((resolve, reject) => {
		cloudinary.uploader.upload_stream((error: any, data: any) => {
			if (error) {
				reject(error);
			} else {
				resolve(data);
			}
		}).end(image);
	});
	// @ts-expect-error: Untyped
	return response.secure_url;
};

const SIZE = 20;
const MARGIN = 3;

const generateQuizQrcode = async ({data, mode, isUnmasked}: { data: string, mode: QRCodeSegmentMode, isUnmasked: boolean}) => {
	const qrcode = QRCode.create([{data, mode}], {
		toSJISFunc: toSJIS,
		version: 1,
		errorCorrectionLevel: 'L',
		...(isUnmasked ? {maskPattern: 0} : {}),
	});

	const modules = qrcode.modules.data;
	const imageCells = qrcode.modules.size + MARGIN * 2;

	const image = await sharp(Buffer.from(Array.from(
		{length: (imageCells * SIZE) ** 2},
		(_d, i) => {
			const rx = Math.floor((i % (imageCells * SIZE)) / SIZE);
			const ry = Math.floor(i / (imageCells * SIZE * SIZE));

			if (
				rx < MARGIN ||
				ry < MARGIN ||
				rx >= imageCells - MARGIN ||
				ry >= imageCells - MARGIN
			) {
				return 255;
			}

			const x = rx - MARGIN;
			const y = ry - MARGIN;

			if (
				(x < 7 && y < 7) ||
				(x >= qrcode.modules.size - 7 && y < 7) ||
				(x < 7 && y >= qrcode.modules.size - 7)
			) {
				return 200;
			}

			const bit = modules[y * qrcode.modules.size + x];
			const isReserved = qrcode.modules.reservedBit[y * qrcode.modules.size + x];

			if (!isUnmasked || isReserved === 1) {
				return bit === 0 ? 255 : 0;
			}

			return (bit ^ (x % 2) ^ (y % 2) ^ 1) === 0 ? 255 : 0;
		},
	)), {
		raw: {
			width: imageCells * SIZE,
			height: imageCells * SIZE,
			channels: 1,
		},
	}).png().toBuffer();

	return image;
};

const generateOriginalQrcode = async ({data, mode, isUnmasked}: { data: string, mode: QRCodeSegmentMode, isUnmasked: boolean}) => {
	const qrcode = QRCode.create([{data, mode}], {
		toSJISFunc: toSJIS,
		version: 1,
		errorCorrectionLevel: 'L',
		...(isUnmasked ? {maskPattern: 0} : {}),
	});

	const modules = qrcode.modules.data;
	const imageCells = qrcode.modules.size + MARGIN * 2;

	const image = await sharp(Buffer.from(Array.from(
		{length: (imageCells * SIZE) ** 2},
		(_d, i) => {
			const rx = Math.floor((i % (imageCells * SIZE)) / SIZE);
			const ry = Math.floor(i / (imageCells * SIZE * SIZE));

			if (
				rx < MARGIN ||
				ry < MARGIN ||
				rx >= imageCells - MARGIN ||
				ry >= imageCells - MARGIN
			) {
				return 255;
			}

			const x = rx - MARGIN;
			const y = ry - MARGIN;

			return modules[y * qrcode.modules.size + x] === 0 ? 255 : 0;
		},
	)), {
		raw: {
			width: imageCells * SIZE,
			height: imageCells * SIZE,
			channels: 1,
		},
	}).png().toBuffer();

	return image;
};

const generateQrcode = async ({data, mode, isUnmasked}: {data: string, mode: QRCodeSegmentMode, isUnmasked: boolean}) => {
	const quizQrcode = await generateQuizQrcode({data, mode, isUnmasked});
	const originalQrcode = await generateOriginalQrcode({data, mode, isUnmasked});

	return {
		quiz: await uploadImage(quizQrcode),
		original: await uploadImage(originalQrcode),
	};
};

type Difficulty = 'easy' | 'normal' | 'hard';
type Mode = 'alphabet' | 'hiragana' | 'numeric' | 'kanji' | 'random';

const parseQuizOptions = (text: string) => {
	const tokens = text.split(/\s+/);

	let isUnmasked = false;
	let difficulty: Difficulty = 'easy';
	let mode: Mode = 'random';
	for (const token of tokens) {
		if (token.toLowerCase() === 'unmasked') {
			isUnmasked = true;
		}
		if (token.toLowerCase() === 'easy') {
			difficulty = 'easy';
		}
		if (token.toLowerCase() === 'normal') {
			difficulty = 'normal';
		}
		if (token.toLowerCase() === 'hard') {
			difficulty = 'hard';
		}
		if (token.toLowerCase() === 'numeric') {
			mode = 'numeric';
		}
		if (token.toLowerCase() === 'alphabet') {
			mode = 'alphabet';
		}
		if (token.toLowerCase() === 'hiragana') {
			mode = 'hiragana';
		}
		if (token.toLowerCase() === 'kanji') {
			mode = 'kanji';
		}
		if (token.toLowerCase() === 'random') {
			mode = 'random';
		}
	}

	return {
		isUnmasked,
		difficulty,
		mode,
	};
};

type TahoiyaWord = [word: string, ruby: string, source: string, meaning: string, id: string];

const hangmanDictionaryLoader = new Loader<string[]>(getDictionary);
const hiraganaDictionaryLoader = new Loader<string[]>(async () => (
	(await getCandidateWords({min: 0, max: Infinity}) as TahoiyaWord[])
		.map(([, ruby]) => ruby)
));
const kanjiDictionaryLoader = new Loader<string[]>(async () => (
	(await getCandidateWords({min: 0, max: Infinity}) as TahoiyaWord[])
		.map(([word]) => word)
		.filter((word) => word.match(/^[一-龠]+$/))
));

const getAlphabetText = async (difficulty: Difficulty) => {
	const hangmanDictionary = await hangmanDictionaryLoader.load();

	if (difficulty === 'easy') {
		const candidateWords = hangmanDictionary
			.slice(0, 1000)
			.filter((word) => word.length === 3 || word.length === 4);
		return sample(candidateWords).toUpperCase();
	}

	if (difficulty === 'normal') {
		const candidateWords = hangmanDictionary
			.slice(0, 2000)
			.filter((word) => word.length >= 5 && word.length <= 8);
		return sample(candidateWords).toUpperCase();
	}

	const candidateWords = hangmanDictionary
		.slice(0, 8000)
		.filter((word) => word.length >= 9 || word.length <= 25);
	return sample(candidateWords).toUpperCase();
};

const getHiraganaText = async (difficulty: Difficulty) => {
	const tahoiyaDictionary = await hiraganaDictionaryLoader.load();

	if (difficulty === 'easy') {
		const candidateWords = tahoiyaDictionary
			.filter((word) => word.length === 2);
		return sample(candidateWords);
	}

	if (difficulty === 'normal') {
		const candidateWords = tahoiyaDictionary
			.filter((word) => word.length >= 3 && word.length <= 6);
		return sample(candidateWords);
	}

	const candidateWords = tahoiyaDictionary
		.filter((word) => word.length >= 7 && word.length <= 10);
	return sample(candidateWords);
};

const getNumericText = (difficulty: Difficulty) => {
	if (difficulty === 'easy') {
		return random(999).toString();
	}

	if (difficulty === 'normal') {
		return random(1_000_000, 999_999_999).toString();
	}

	return Array(40).fill('').map(() => random(9).toString()).join('');
};

const getKanjiText = async (difficulty: Difficulty) => {
	const tahoiyaDictionary = await kanjiDictionaryLoader.load();

	if (difficulty === 'easy') {
		const candidateWords = tahoiyaDictionary
			.filter((word) => word.length === 1);
		logger.info(new Set(candidateWords).size);
		logger.info(writeFileSync(`${__dirname}/temp.txt`, Array.from(new Set(candidateWords)).sort().join('')));
		return sample(candidateWords);
	}

	if (difficulty === 'normal') {
		const candidateWords = tahoiyaDictionary
			.filter((word) => word.length === 2);
		return sample(candidateWords);
	}

	const candidateWords = tahoiyaDictionary
		.filter((word) => word.length >= 3 && word.length <= 10);
	return sample(candidateWords);
};

const generateQuiz = async (difficulty: Difficulty, modeOption: Mode): Promise<{
	gameMode: Mode,
	mode: QRCodeSegmentMode,
	data: string,
}> => {
	let mode = modeOption;
	if (mode === 'random') {
		if (difficulty === 'easy') {
			mode = sample(['alphabet', 'hiragana']);
		}
		if (difficulty === 'normal') {
			mode = sample(['alphabet', 'hiragana', 'numeric']);
		}
		if (difficulty === 'hard') {
			mode = sample(['alphabet', 'hiragana', 'numeric', 'kanji']);
		}
	}

	if (mode === 'alphabet') {
		return {
			gameMode: mode,
			mode: 'alphanumeric',
			data: await getAlphabetText(difficulty),
		};
	}

	if (mode === 'hiragana') {
		return {
			gameMode: mode,
			mode: 'kanji',
			data: await getHiraganaText(difficulty),
		};
	}

	if (mode === 'numeric') {
		return {
			gameMode: mode,
			mode: 'numeric',
			data: getNumericText(difficulty),
		};
	}

	return {
		gameMode: mode,
		mode: 'kanji',
		data: await getKanjiText(difficulty),
	};
};

class QrAteQuiz extends AteQuiz {
	startTime: number;

	endTime: number;

	waitSecGen() {
		return 300;
	}

	start() {
		this.startTime = Date.now();
		return super.start();
	}

	solvedMessageGen(message: GenericMessageEvent) {
		this.endTime = Date.now();

		const duration = (this.endTime - this.startTime) / 1000;
		const durationSeconds = duration % 60;
		const durationMinutes = Math.floor(duration / 60);
		const durationText = durationMinutes > 0
			? `${durationMinutes}分${durationSeconds.toFixed(1)}秒`
			: `${durationSeconds.toFixed(1)}秒`;

		return {
			...this.problem.solvedMessage,
			text: stripIndent`
				<@${message.user}> 正解:tada: 答えは ＊${this.problem.correctAnswers[0]}＊ だよ:muscle:
				回答時間: ${durationText}
			`,
		};
	}
}

export default (slackClients: SlackInterface) => {
	const {eventClient, webClient: slack} = slackClients;

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		const {text, channel} = message;

		if (
			text &&
				text.startsWith('QR当てクイズ')
		) {
			if (mutex.isLocked()) {
				slack.chat.postEphemeral({
					channel,
					text: '今クイズ中だよ',
					user: message.user,
				});
				return;
			}

			mutex.runExclusive(async () => {
				const quizOptions = parseQuizOptions(text.slice('QR当てクイズ'.length));
				const quiz = await generateQuiz(quizOptions.difficulty, quizOptions.mode);
				const imageUrl = await generateQrcode({
					data: quiz.data,
					mode: quiz.mode,
					isUnmasked: quizOptions.isUnmasked,
				});

				const standardRuleUrl = 'https://scrapbox.io/tsg/QR%E5%BD%93%E3%81%A6%E3%82%AF%E3%82%A4%E3%82%BA%2F%E6%A8%99%E6%BA%96%E3%83%AB%E3%83%BC%E3%83%AB';
				const quizText = `このQRコード、なんと書いてあるでしょう? (difficulty = ${quizOptions.difficulty}, mode = ${quizOptions.mode}, masked = ${!quizOptions.isUnmasked}) <${standardRuleUrl}|[標準ルール]>`;

				const ateQuiz = new QrAteQuiz(slackClients, {
					problemMessage: {
						channel,
						text: quizText,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: quizText,
								},
								accessory: {
									type: 'image',
									image_url: imageUrl.quiz,
									alt_text: 'QRコード',
								},
							},
						],
						unfurl_links: false,
						unfurl_media: false,
					},
					hintMessages: [],
					immediateMessage: {
						channel,
						text: '300秒以内に回答してね！',
						blocks: [
							{
								type: 'section',
								text: {
									type: 'plain_text',
									text: '300秒以内に回答してね！',
								},
							},
							{
								type: 'image',
								image_url: imageUrl.quiz,
								alt_text: 'QRコード',
							},
						],
					},
					solvedMessage: {
						channel,
						text: '',
					},
					unsolvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.unsolved(` ＊${quiz.data}＊ `),
					},
					answerMessage: {
						channel,
						text: 'QRコード',
						blocks: [
							{
								type: 'image',
								image_url: imageUrl.original,
								alt_text: quiz.data,
							},
						],
					},
					correctAnswers: [quiz.data, quiz.data.toLowerCase()],
				}, {});

				const result = await ateQuiz.start();
				const duration = ateQuiz.endTime - ateQuiz.startTime;

				if (result.state === 'solved' && quizOptions.isUnmasked === true) {
					await increment(result.correctAnswerer, 'qrcode-quiz-answer-unmasked');
				}

				if (result.state === 'solved' && quizOptions.isUnmasked === false) {
					await increment(result.correctAnswerer, 'qrcode-quiz-answer');
					if (quiz.gameMode === 'alphabet') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-alphabet');
					}
					if (quiz.gameMode === 'hiragana') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-hiragana');
					}
					if (quiz.gameMode === 'kanji') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-kanji');
					}
					if (quiz.gameMode === 'numeric') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-numeric');
					}
					if (quizOptions.difficulty === 'easy') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-easy-or-above');
					}
					if (quizOptions.difficulty === 'normal') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-easy-or-above');
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-normal-or-above');
					}
					if (quizOptions.difficulty === 'hard') {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-easy-or-above');
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-normal-or-above');
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-hard-or-above');
					}
					if (duration < 10000) {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-less-than-10s');
					}
					if (duration < 30000) {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-less-than-30s');
					}
					if (duration < 45000) {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-less-than-45s');
					}
					if (duration < 150000) {
						await increment(result.correctAnswerer, 'qrcode-quiz-answer-less-than-150s');
					}
				}
			});
		}
	});
};
