import fs from 'fs';
import path from 'path';
import {promisify} from 'util';
// @ts-expect-error: untyped
import download from 'download';
// @ts-expect-error: untyped
import {hiraganize} from 'japanese';
import {shuffle} from 'lodash';

export type WordEntry = [word: string, ruby: string, source: string, ...rest: string[]];

export interface GetCandidateWordsOptions {
	min?: number;
	max?: number;
}

export const getCandidateWords = async ({min = 3, max = 7}: GetCandidateWordsOptions = {}): Promise<WordEntry[]> => {
	const [
		wikipediaText,
		wiktionaryText,
		nicopediaText,
		asciiText,
		binaryText,
		ewordsText,
		fideliText,
	] = await Promise.all([
		['wikipedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wikipedia.txt'],
		['wiktionary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wiktionary.txt'],
		['nicopedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/nicopedia.txt'],
		['ascii.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ascii.txt'],
		['binary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/binary.txt'],
		['ewords.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ewords.txt'],
		['fideli.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/fideli.txt'],
	].map(async ([filename, url]: [string, string]): Promise<string> => {
		const dataPath = path.join(__dirname, '..', 'tahoiya', filename);

		const dataExists = await new Promise<boolean>((resolve) => {
			fs.access(dataPath, fs.constants.F_OK, (error) => {
				resolve(!error);
			});
		});

		if (dataExists) {
			const databaseBuffer = await promisify(fs.readFile)(dataPath);
			return databaseBuffer.toString();
		}

		const databaseBuffer = await download(url);
		await promisify(fs.writeFile)(dataPath, databaseBuffer);
		return databaseBuffer.toString();
	}));

	const databaseWords: WordEntry[] = [
		...wikipediaText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => {
			const [word, ruby] = line.split('\t');
			return [word, ruby, 'wikipedia'];
		}),
		...wiktionaryText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
			'wiktionary',
		]),
		...nicopediaText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
			'nicopedia',
			line.split('\t')[2],
		]),
		...asciiText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => [
			line.split('\t')[0],
			line.split('\t')[1],
			'ascii',
			line.split('\t')[2],
		]),
		...binaryText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => [
			line.split('\t')[0],
			line.split('\t')[1],
			'binary',
			line.split('\t')[2],
		]),
		...ewordsText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => [
			line.split('\t')[0],
			line.split('\t')[1],
			'ewords',
			line.split('\t')[2],
		]),
		...fideliText.split('\n').filter((line) => line.length !== 0).map((line): WordEntry => [
			line.split('\t')[0],
			line.split('\t')[1],
			'fideli',
			line.split('\t')[2],
			line.split('\t')[3],
		]),
	];

	const candidateWords = shuffle(databaseWords.filter(([, ruby]) => ruby.length >= min && ruby.length <= max));

	return candidateWords;
};
