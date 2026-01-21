"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = characterQuiz;
const async_mutex_1 = require("async-mutex");
const axios_1 = __importDefault(require("axios"));
const cloudinary_1 = __importDefault(require("cloudinary"));
// @ts-expect-error: Missing types
const japanese_1 = require("japanese");
const lodash_1 = require("lodash");
const achievements_1 = require("../achievements");
const atequiz_1 = require("../atequiz");
const channelLimitedBot_1 = require("../lib/channelLimitedBot");
const state_1 = __importDefault(require("../lib/state"));
const utils_1 = require("../lib/utils");
const mutex = new async_mutex_1.Mutex();
class CharacterQuiz extends atequiz_1.AteQuiz {
    judge(answer) {
        const userAnswer = (0, japanese_1.hiraganize)(answer.replace(/\P{Letter}/gu, '').toLowerCase());
        return this.problem.correctAnswers.some((rawAnswer) => {
            const normalizedAnswer = (0, japanese_1.hiraganize)(rawAnswer.replace(/\P{Letter}/gu, '').toLowerCase());
            return userAnswer === normalizedAnswer;
        });
    }
}
const loadCharacters = async (author) => {
    const { data } = await axios_1.default.get(`https://github.com/hakatashi/namori_rakugaki_annotation/raw/master/${author}.csv`);
    const lines = data
        .split('\n')
        .slice(1)
        .filter((line) => line.length > 0);
    return lines
        .flatMap((line) => {
        const [tweetId, mediaId, imageUrl, characterName, characterRuby, workName, rating,] = line.split(',');
        const characterNames = characterName.split('、').filter((name) => name !== '');
        const characterRubys = characterRuby.split('、').filter((name) => name !== '');
        if (characterNames.length === 0 || characterRubys.length === 0) {
            return [];
        }
        const names = [...characterNames, ...characterRubys];
        const namePartsList = names.map((name) => name.split('&').map((nameOne) => nameOne.split(' ')));
        const normalizedWorkName = workName.startsWith('"')
            ? workName.slice(1, -1)
            : workName;
        return [
            {
                tweetId,
                mediaId,
                imageUrl,
                characterName: characterNames[0].replace(/ /g, ''),
                workName: normalizedWorkName,
                validAnswers: [
                    ...namePartsList.map((name) => name.flat().join('')),
                    ...namePartsList.map((name) => name.map((nameOne) => nameOne.join(''))).flat(),
                    ...namePartsList.flat().flat(),
                ],
                author,
                rating: rating ?? '0',
                characterId: `${namePartsList[0].flat().join('')}\0${normalizedWorkName}`,
            },
        ];
    })
        .filter(({ rating }) => rating === '0');
};
const loaderNamori = new utils_1.Loader(() => loadCharacters('namori'));
const loaderIxy = new utils_1.Loader(() => loadCharacters('ixy'));
const getUrl = (publicId, options = {}) => cloudinary_1.default.v2.url(`${publicId}.jpg`, {
    private_cdn: false,
    secure: true,
    secure_distribution: 'res.cloudinary.com',
    ...options,
});
const uploadImage = async (url) => {
    const cloudinaryDatum = await cloudinary_1.default.v2.uploader.upload(url);
    return {
        imageId: cloudinaryDatum.public_id,
        width: cloudinaryDatum.width,
        height: cloudinaryDatum.height,
    };
};
const getHintOptions = ({ width, height }, n) => {
    if (n <= 0) {
        const newHeight = Math.floor(width / 100);
        return {
            transformation: [
                {
                    width,
                    height: newHeight,
                    crop: 'crop',
                    y: (0, lodash_1.random)(height - newHeight),
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
                    x: (0, lodash_1.random)(width - newSize),
                    y: (0, lodash_1.random)(height - newSize),
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
                    x: (0, lodash_1.random)(width - newSize),
                    y: (0, lodash_1.random)(height - newSize),
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
                    x: (0, lodash_1.random)(width - newSize),
                    y: (0, lodash_1.random)(height - newSize),
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
                y: (0, lodash_1.random)(height - newHeight),
            },
        ],
    };
};
const generateProblem = async (character, channel) => {
    const image = await uploadImage(character.imageUrl);
    const problemMessage = {
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
    const hintMessages = atequiz_1.typicalAteQuizHintTexts.map((text, index) => ({
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
                ? (0, lodash_1.range)(3).map(() => ({
                    type: 'context',
                    elements: (0, lodash_1.range)(10).map(() => ({
                        type: 'image',
                        image_url: getUrl(image.imageId, getHintOptions(image, 1)),
                        alt_text: text,
                    })),
                }))
                : [
                    {
                        type: 'image',
                        block_id: 'image',
                        image_url: getUrl(image.imageId, getHintOptions(image, index + 1)),
                        alt_text: text,
                    },
                ]),
        ],
    }));
    const immediateMessage = {
        channel,
        text: atequiz_1.typicalMessageTextsGenerator.immediate(), // note: Originally, ...
    };
    const solvedMessage = {
        channel,
        text: atequiz_1.typicalMessageTextsGenerator.solved(`＊${character.characterName}＊ (${character.workName})`), // note: Origina...
        reply_broadcast: true,
    };
    const unsolvedMessage = {
        channel,
        text: atequiz_1.typicalMessageTextsGenerator.unsolved(`＊${character.characterName}＊ (${character.workName}) `), // note: Ori...
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
                },
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
    };
    return problem;
};
class CharacterQuizBot extends channelLimitedBot_1.ChannelLimitedBot {
    slackClients;
    persistentState;
    wakeWordRegex = /^(?:キャラ|なもり|Ixy)当てクイズ$/;
    username = 'namori';
    iconEmoji = ':namori:';
    constructor(slackClients, persistentState) {
        super(slackClients);
        this.slackClients = slackClients;
        this.persistentState = persistentState;
    }
    onWakeWord(message, channel) {
        const quizMessageDeferred = new utils_1.Deferred();
        mutex.runExclusive(async () => {
            const characters = await (async () => {
                const namori = message.text === 'キャラ当てクイズ' ||
                    message.text === 'なもり当てクイズ' ? await loaderNamori.load() : [];
                const ixy = message.text === 'キャラ当てクイズ' ||
                    message.text === 'Ixy当てクイズ' ? await loaderIxy.load() : [];
                return [...namori, ...ixy];
            })();
            const candidateCharacterIds = characters
                .filter((character) => !this.persistentState.recentCharacterIds.includes(character.characterId))
                .map(({ characterId }) => characterId);
            const answerCharacterId = (0, lodash_1.sample)(Array.from(new Set(candidateCharacterIds)));
            const answer = (0, lodash_1.sample)(characters.filter((character) => character.characterId === answerCharacterId));
            const problem = await generateProblem(answer, channel);
            const quiz = new CharacterQuiz(this.slackClients, problem, {
                username: this.username,
                icon_emoji: this.iconEmoji,
            });
            this.persistentState.recentCharacterIds.push(answer.characterId);
            while (this.persistentState.recentCharacterIds.length > 200) {
                this.persistentState.recentCharacterIds.shift();
            }
            const result = await quiz.start({
                mode: 'normal',
                onStarted(startMessage) {
                    quizMessageDeferred.resolve(startMessage.ts);
                },
            });
            await this.deleteProgressMessage(await quizMessageDeferred.promise);
            if (result.state === 'solved') {
                // Achievements for all quizzes
                await (0, achievements_1.increment)(result.correctAnswerer, 'chara-ate-answer');
                if (result.hintIndex === 0) {
                    await (0, achievements_1.increment)(result.correctAnswerer, 'chara-ate-answer-first-hint');
                }
                if (result.hintIndex <= 1) {
                    await (0, achievements_1.increment)(result.correctAnswerer, 'chara-ate-answer-second-hint');
                }
                if (result.hintIndex <= 2) {
                    await (0, achievements_1.increment)(result.correctAnswerer, 'chara-ate-answer-third-hint');
                }
                // for author-specific quizzes
                await (0, achievements_1.increment)(result.correctAnswerer, `${problem.correctCharacter.author}-answer`);
                if (result.hintIndex === 0) {
                    await (0, achievements_1.increment)(result.correctAnswerer, `${problem.correctCharacter.author}-answer-first-hint`);
                }
                if (result.hintIndex <= 1) {
                    await (0, achievements_1.increment)(result.correctAnswerer, `${problem.correctCharacter.author}-answer-second-hint`);
                }
                if (result.hintIndex <= 2) {
                    await (0, achievements_1.increment)(result.correctAnswerer, `${problem.correctCharacter.author}-answer-third-hint`);
                }
            }
        }).catch((error) => {
            this.log.error('Failed to start character quiz', error);
            const errorText = error instanceof Error && error.stack !== undefined
                ? error.stack : String(error);
            this.postMessage({
                channel,
                text: `エラー😢\n\`${errorText}\``,
            });
            quizMessageDeferred.reject(error);
        });
        return quizMessageDeferred.promise;
    }
}
// eslint-disable-next-line require-jsdoc
async function characterQuiz(slackClients) {
    const persistentState = await state_1.default.init('anime-namori', {
        recentMediaIds: [],
        recentCharacterIds: [],
    });
    return new CharacterQuizBot(slackClients, persistentState);
}
