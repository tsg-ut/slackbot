import fs from 'fs';
import path from 'path';
import querystring from 'querystring';
import {promisify} from 'util';
import axios from 'axios';
// @ts-expect-error: No type definitions available
import download from 'download';
// @ts-expect-error: No type definitions available
import {hiraganize} from 'japanese';
import {get, last, shuffle} from 'lodash';
import moment from 'moment';
import logger from '../lib/logger';

const log = logger.child({bot: 'tahoiya'});

export const getPageTitle = (url: string): string => {
	const urlTitle = decodeURI(url.match(/([^/]+)$/)![1]);

	if (url.startsWith('https://ja.wikipedia.org')) {
		return `${urlTitle} - Wikipedia`;
	}

	if (url.startsWith('https://ja.wiktionary.org')) {
		return `${urlTitle} - ウィクショナリー日本語版`;
	}

	if (url.startsWith('http://yougo.ascii.jp')) {
		return `${urlTitle} - 意味・説明・解説 : ASCII.jpデジタル用語辞典`;
	}

	if (url.startsWith('http://www.sophia-it.com')) {
		return `${urlTitle} - IT用語辞典バイナリ`;
	}

	if (url.startsWith('http://e-words.jp')) {
		const rawUrlTitle = urlTitle.replace(/\.html$/, '');
		return `${rawUrlTitle} - IT用語辞典`;
	}

	if (url.startsWith('http://dic-it.fideli.com/')) {
		return 'フィデリ IT用語辞典';
	}

	if (url.startsWith('http://dic.nicovideo.jp')) {
		return `${urlTitle} - ニコニコ大百科`;
	}

	throw new Error(`Unknown URL format: ${url}`);
};

export const getWordUrl = (word: string, source: string, id?: string): string => {
	if (source === 'wikipedia') {
		return `https://ja.wikipedia.org/wiki/${encodeURIComponent(word)}`;
	}

	if (source === 'wiktionary') {
		return `https://ja.wiktionary.org/wiki/${encodeURIComponent(word)}`;
	}

	if (source === 'ascii') {
		return `http://yougo.ascii.jp/caltar/${encodeURIComponent(word)}`;
	}

	if (source === 'binary') {
		return `http://www.sophia-it.com/content/${encodeURIComponent(word)}`;
	}

	if (source === 'ewords') {
		return `http://e-words.jp/w/${encodeURIComponent(word)}.html`;
	}

	if (source === 'fideli') {
		return `http://dic-it.fideli.com/dictionary/m/word/w/${encodeURIComponent(id!)}/index.html`;
	}

	if (source === 'nicopedia') {
		return `http://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
	}

	throw new Error(`Unknown source: ${source}`);
};

export const getIconUrl = (source: string): string => {
	if (source === 'wikipedia') {
		return 'https://ja.wikipedia.org/static/favicon/wikipedia.ico';
	}

	if (source === 'wiktionary') {
		return 'https://ja.wiktionary.org/static/favicon/piece.ico';
	}

	if (source === 'ascii') {
		return 'http://ascii.jp/img/favicon.ico';
	}

	if (source === 'binary') {
		return 'http://www.sophia-it.com/favicon.ico';
	}

	if (source === 'ewords') {
		return 'http://p.e-words.jp/favicon.png';
	}

	if (source === 'fideli') {
		return 'http://dic-it.fideli.com/image/favicon.ico';
	}

	if (source === 'nicopedia') {
		return 'http://dic.nicovideo.jp/favicon.ico';
	}

	throw new Error(`Unknown source: ${source}`);
};

export const getTimeLink = (time: number): string => {
	const text = moment(time).utcOffset('+0900').format('HH:mm:ss');
	const url = `https://www.timeanddate.com/countdown/generic?${querystring.stringify({
		iso: moment(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
		p0: 248,
		msg: 'たほいや登録終了まで',
		font: 'sansserif',
		csz: 1,
	})}`;
	return `<${url}|${text}>`;
};

export const normalizeMeaning = (input: string): string => {
	let meaning = input;
	meaning = meaning.replace(/[=]= (.+?) ==/g, '$1');
	meaning = meaning.replace(/\(.+?\)/g, '');
	meaning = meaning.replace(/（.+?）/g, '');
	meaning = meaning.replace(/【.+?】/g, '');
	meaning = meaning.replace(/。.*$/, '');
	meaning = meaning.replace(/^.+? -/, '');
	meaning = meaning.replace(/(のこと|をいう|である)+$/, '');
	meaning = meaning.replace(/，/g, '、');
	meaning = meaning.replace(/．/g, '。');
	return meaning.trim();
};

export const getMeaning = async (wordData: [string, string, string, string, string?]): Promise<string> => {
	const [word, , source, rawMeaning] = wordData;

	if (source !== 'wikipedia' && source !== 'wiktionary') {
		return rawMeaning;
	}

	let wikitext: string | null = null;
	let exsentences = 0;

	await axios.post(
		(source === 'wikipedia' ? 'https://ja.wikipedia.org/w/api.php?' : 'https://ja.wiktionary.org/w/api.php?') + querystring.stringify({
			action: 'purge',
			titles: word,
			format: 'json',
		}),
		{
			responseType: 'json',
		},
	);

	do {
		exsentences++;

		const response = await axios.get(
			source === 'wikipedia' ? 'https://ja.wikipedia.org/w/api.php' : 'https://ja.wiktionary.org/w/api.php',
			{
				params: {
					action: 'query',
					prop: 'extracts',
					titles: word,
					exlimit: 1,
					...(source === 'wikipedia' ? {exintro: true} : {}),
					explaintext: true,
					exsentences,
					redirects: 1,
					format: 'json',
				},
				responseType: 'json',
			},
		);

		const pages = get(response, ['data', 'query', 'pages']);
		if (typeof pages === 'object') {
			wikitext = get(Object.values(pages), [0, 'extract'], null);
		}
	} while (exsentences < 3 && (wikitext === null || wikitext.endsWith('?')));

	if (!wikitext) {
		log.error(`Couldn't find article for ${word}`);
		return '';
	}

	log.info(wikitext);

	let meaning: string | null = null;
	const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

	if (lines.length > 1) {
		meaning = source === 'wikipedia' ? lines[1] : last(lines)!;
		meaning = normalizeMeaning(meaning);
	} else {
		meaning = normalizeMeaning(wikitext);
		if (meaning.includes('とは、')) {
			meaning = meaning.replace(/^.+?とは、/, '');
		} else if (meaning.includes('は、')) {
			meaning = meaning.replace(/^.+?は、/, '');
		} else if (meaning.includes('とは')) {
			meaning = meaning.replace(/^.+?とは/, '');
		} else if (meaning.includes('、')) {
			meaning = meaning.replace(/^.+?、/, '');
		} else {
			meaning = meaning.replace(/^.+?は/, '');
		}
		meaning = meaning.replace(/であり、.+$/, '');
		meaning = meaning.replace(/で、.+$/, '');
	}

	meaning = meaning.trim();

	return meaning;
};

export const getCandidateWords = async (options: {min?: number, max?: number} = {}): Promise<any[]> => {
	const {min = 3, max = 7} = options;

	const fileDownloads = [
		['wikipedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wikipedia.txt'],
		['wiktionary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/wiktionary.txt'],
		['nicopedia.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/nicopedia.txt'],
		['ascii.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ascii.txt'],
		['binary.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/binary.txt'],
		['ewords.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/ewords.txt'],
		['fideli.txt', 'https://s3-ap-northeast-1.amazonaws.com/hakata-public/slackbot/fideli.txt'],
	];

	const texts = await Promise.all(fileDownloads.map(async ([filename, url]) => {
		const dataPath = path.join(__dirname, filename);

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

	const [
		wikipediaText,
		wiktionaryText,
		nicopediaText,
		asciiText,
		binaryText,
		ewordsText,
		fideliText,
	] = texts;

	const databaseWords = [
		...wikipediaText.split('\n').filter((line) => line.length !== 0).map((line) => [
			...line.split('\t'),
			'wikipedia',
		]),
		...wiktionaryText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
			'wiktionary',
		]),
		...nicopediaText.split('\n').filter((line) => line.length !== 0).map((line) => [
			line.split('\t')[0],
			hiraganize(line.split('\t')[1]),
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

	const candidateWords = shuffle(databaseWords.filter(([, ruby]) => ruby.length >= min && ruby.length <= max));

	return candidateWords;
};
