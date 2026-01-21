"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCandidateWords = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
// @ts-expect-error: untyped
const download_1 = __importDefault(require("download"));
// @ts-expect-error: untyped
const japanese_1 = require("japanese");
const lodash_1 = require("lodash");
const getCandidateWords = async ({ min = 3, max = 7 } = {}) => {
    const [wikipediaText, wiktionaryText, nicopediaText, asciiText, binaryText, ewordsText, fideliText,] = await Promise.all([
        ['wikipedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wikipedia.txt'],
        ['wiktionary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wiktionary.txt'],
        ['nicopedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/nicopedia.txt'],
        ['ascii.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ascii.txt'],
        ['binary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/binary.txt'],
        ['ewords.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ewords.txt'],
        ['fideli.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/fideli.txt'],
    ].map(async ([filename, url]) => {
        const dataPath = path_1.default.join(__dirname, '..', 'tahoiya', filename);
        const dataExists = await new Promise((resolve) => {
            fs_1.default.access(dataPath, fs_1.default.constants.F_OK, (error) => {
                resolve(!error);
            });
        });
        if (dataExists) {
            const databaseBuffer = await (0, util_1.promisify)(fs_1.default.readFile)(dataPath);
            return databaseBuffer.toString();
        }
        const databaseBuffer = await (0, download_1.default)(url);
        await (0, util_1.promisify)(fs_1.default.writeFile)(dataPath, databaseBuffer);
        return databaseBuffer.toString();
    }));
    const databaseWords = [
        ...wikipediaText.split('\n').filter((line) => line.length !== 0).map((line) => {
            const [word, ruby] = line.split('\t');
            return [word, ruby, 'wikipedia'];
        }),
        ...wiktionaryText.split('\n').filter((line) => line.length !== 0).map((line) => [
            line.split('\t')[0],
            (0, japanese_1.hiraganize)(line.split('\t')[1]),
            'wiktionary',
        ]),
        ...nicopediaText.split('\n').filter((line) => line.length !== 0).map((line) => [
            line.split('\t')[0],
            (0, japanese_1.hiraganize)(line.split('\t')[1]),
            'nicopedia',
            line.split('\t')[2],
        ]),
        ...asciiText.split('\n').filter((line) => line.length !== 0).map((line) => [
            line.split('\t')[0],
            line.split('\t')[1],
            'ascii',
            line.split('\t')[2],
        ]),
        ...binaryText.split('\n').filter((line) => line.length !== 0).map((line) => [
            line.split('\t')[0],
            line.split('\t')[1],
            'binary',
            line.split('\t')[2],
        ]),
        ...ewordsText.split('\n').filter((line) => line.length !== 0).map((line) => [
            line.split('\t')[0],
            line.split('\t')[1],
            'ewords',
            line.split('\t')[2],
        ]),
        ...fideliText.split('\n').filter((line) => line.length !== 0).map((line) => [
            line.split('\t')[0],
            line.split('\t')[1],
            'fideli',
            line.split('\t')[2],
            line.split('\t')[3],
        ]),
    ];
    const candidateWords = (0, lodash_1.shuffle)(databaseWords.filter(([, ruby]) => ruby.length >= min && ruby.length <= max));
    return candidateWords;
};
exports.getCandidateWords = getCandidateWords;
