import type {
	ImageBlock,
	MrkdwnElement,
	ChatPostMessageArguments,
} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import cloudinary from 'cloudinary';
import type {CommonTransformationOptions} from 'cloudinary';
// @ts-expect-error
import {hiraganize} from 'japanese';
import {random, sample, range} from 'lodash';
import {increment} from '../achievements';
import {
	AteQuizProblem,
	AteQuiz,
	typicalMessageTextsGenerator,
	typicalAteQuizHintTexts,
} from '../atequiz';
import {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';

const mutex = new Mutex();

interface CharacterData {
  tweetId: string;
  mediaId: string;
  imageUrl: string;
  characterName: string;
  workName: string;
  validAnswers: string[];
  author: string;
  rating: string;
  characterId: string;
}

interface PersistentState {
  recentMediaIds: string[];
  recentCharacterIds: string[];
}

interface CharacterQuizProblem extends AteQuizProblem {
  correctCharacter: CharacterData;
}

class CharacterQuiz extends AteQuiz {
	judge(answer: string): boolean {
		const userAnswer = hiraganize(
			answer.replace(/\P{Letter}/gu, '').toLowerCase(),
		);
		return this.problem.correctAnswers.some((rawAnswer) => {
			const normalizedAnswer = hiraganize(
				rawAnswer.replace(/\P{Letter}/gu, '').toLowerCase(),
			);
			return userAnswer === normalizedAnswer;
		});
	}
}

const loadCharacters = async (author: string) => {
	const {data} = await axios.get<string>(
		`https://github.com/hakatashi/namori_rakugaki_annotation/raw/master/${author}.csv`,
	);
	const lines = data
		.split('\n')
		.slice(1)
		.filter((line) => line.length > 0);
	return lines
		.map((line) => {
			const [
				tweetId,
				mediaId,
				imageUrl,
				characterName,
				characterRuby,
				workName,
				rating,
			] = line.split(',');

			const characterNames = characterName.split(/[、&]/);
			const characterRubys = characterRuby.split(/[、&]/);

			const names = [...characterNames, ...characterRubys];
			const namePartsList = names.map((name) => name.split(' '));

			const normalizedWorkName = workName.startsWith('"')
				? workName.slice(1, -1)
				: workName;

			return {
				tweetId,
				mediaId,
				imageUrl,
				characterName: characterNames[0].replace(/ /g, ''),
				workName: normalizedWorkName,
				validAnswers: [
					...namePartsList.map((parts) => parts.join('')),
					...namePartsList.flat(),
				],
				author,
				rating: rating ?? '0',
				characterId: `${namePartsList[0].join('')}\0${normalizedWorkName}`,
			} as CharacterData;
		})
		.filter(({rating}) => rating === '0');
};

const loaderNamori = new Loader<CharacterData[]>(() => loadCharacters('namori'));

const loaderIxy = new Loader<CharacterData[]>(() => loadCharacters('ixy'));

const getUrl = (publicId: string, options = {}) => cloudinary.v2.url(`${publicId}.jpg`, {
	private_cdn: false,
	secure: true,
	secure_distribution: 'res.cloudinary.com',
	...options,
});

const uploadImage = async (url: string) => {
	const cloudinaryDatum = await cloudinary.v2.uploader.upload(url);

	return {
		imageId: cloudinaryDatum.public_id,
		width: cloudinaryDatum.width,
		height: cloudinaryDatum.height,
	};
};

const getHintOptions = (
	{width, height}: { width: number; height: number },
	n: number,
): CommonTransformationOptions => {
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

const postOption = {
	username: 'namori',
	icon_emoji: ':namori:',
};

const generateProblem = async (
	character: CharacterData,
): Promise<CharacterQuizProblem> => {
	const channel = process.env.CHANNEL_SANDBOX;

	const image = await uploadImage(character.imageUrl);

	const problemMessage: ChatPostMessageArguments = {
		channel,
		text: 'このキャラだーれだ',
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
	};

	const hintMessages = typicalAteQuizHintTexts.map((text, index) => ({
		// note: Originally, typicalAteQuizHintTexts is from anime/namori.ts
		channel,
		text,
		blocks: [
			{
				type: 'section',
				text: {
					type: 'plain_text',
					text,
					emoji: true,
				},
			},
			...(index === 0
				? range(3).map(() => ({
					type: 'context',
					elements: range(10).map(
						() => ({
							type: 'image',
							image_url: getUrl(image.imageId, getHintOptions(image, 1)),
							alt_text: text,
						} as ImageBlock),
					),
				}))
				: [
					{
						type: 'image',
						block_id: 'image',
						image_url: getUrl(
							image.imageId,
							getHintOptions(image, index + 1),
						),
						alt_text: text,
					},
				]),
		],
	}));

	const immediateMessage = {
		channel,
		text: typicalMessageTextsGenerator.immediate(), // note: Originally, ...
	};

	const solvedMessage = {
		channel,
		text: typicalMessageTextsGenerator.solved(
			`＊${character.characterName}＊ (${character.workName})`,
		), // note: Origina...
		reply_broadcast: true,
	};

	const unsolvedMessage = {
		channel,
		text: typicalMessageTextsGenerator.unsolved(
			`＊${character.characterName}＊ (${character.workName}) `,
		), // note: Ori...
		reply_broadcast: true,
	};

	const authorId = character.author === 'namori' ? '_namori_' : 'Ixy';

	const answerMessage = {
		channel,
		text: character.characterName,
		unfurl_links: true,
		unfurl_media: true,
		blocks: [
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `https://twitter.com/${authorId}/status/${character.tweetId}`,
				} as MrkdwnElement,
			},
			{
				type: 'image',
				block_id: 'image',
				image_url: getUrl(image.imageId, {}),
				alt_text: character.characterName,
			},
		],
	};

	const correctAnswers = character.validAnswers;

	const problem = {
		problemMessage,
		hintMessages,
		immediateMessage,
		solvedMessage,
		unsolvedMessage,
		answerMessage,
		correctAnswers,
		correctCharacter: character,
	} as CharacterQuizProblem;

	return problem;
};

export default async (slackClients: SlackInterface) => {
	const {eventClient} = slackClients;

	const persistentState = await State.init<PersistentState>('anime-namori', {
		recentMediaIds: [],
		recentCharacterIds: [],
	});

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		mutex.runExclusive(async () => {
			if (
				message.text &&
        message.text.match(/^(?:キャラ|なもり|Ixy)当てクイズ$/)
			) {
				const characters = await (async () => {
					const namori =
            message.text === 'キャラ当てクイズ' ||
            message.text === 'なもり当てクイズ' ? await loaderNamori.load() : [];
					const ixy =
            message.text === 'キャラ当てクイズ' ||
            message.text === 'Ixy当てクイズ' ? await loaderIxy.load() : [];

					return [...namori, ...ixy];
				})();
				const candidateCharacterIds = characters
					.filter(
						(character) => !persistentState.recentCharacterIds.includes(
							character.characterId,
						),
					)
					.map(({characterId}) => characterId);
				const answerCharacterId = sample(
					Array.from(new Set(candidateCharacterIds)),
				);

				const answer = sample(
					characters.filter(
						(character) => character.characterId === answerCharacterId,
					),
				);

				const problem = await generateProblem(answer);
				const quiz = new CharacterQuiz(slackClients, problem, postOption);

				persistentState.recentCharacterIds.push(answer.characterId);
				while (persistentState.recentCharacterIds.length > 200) {
					persistentState.recentCharacterIds.shift();
				}

				const result = await quiz.start();

				if (result.state === 'solved') {
					// Achievements for all quizzes
					await increment(result.correctAnswerer, 'chara-ate-answer');
					if (result.hintIndex === 0) {
						await increment(result.correctAnswerer, 'chara-ate-answer-first-hint');
					}
					if (result.hintIndex <= 1) {
						await increment(result.correctAnswerer, 'chara-ate-answer-second-hint');
					}
					if (result.hintIndex <= 2) {
						await increment(result.correctAnswerer, 'chara-ate-answer-third-hint');
					}

					// for author-specific quizzes
					await increment(
						result.correctAnswerer,
						`${problem.correctCharacter.author}-answer`,
					);
					if (result.hintIndex === 0) {
						await increment(
							result.correctAnswerer,
							`${problem.correctCharacter.author}-answer-first-hint`,
						);
					}
					if (result.hintIndex <= 1) {
						await increment(
							result.correctAnswerer,
							`${problem.correctCharacter.author}-answer-second-hint`,
						);
					}
					if (result.hintIndex <= 2) {
						await increment(
							result.correctAnswerer,
							`${problem.correctCharacter.author}-answer-third-hint`,
						);
					}
				}
			}
		});
	});
};
