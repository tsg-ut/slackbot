import querystring from 'querystring';
import axios from 'axios';
import {get, last} from 'lodash';
import type {WordEntry} from '../lib/candidateWords';
import type {DictionarySource} from './types';

export const SOURCE_LABELS: Record<DictionarySource, string> = {
	wikipedia: 'Wikipedia',
	wiktionary: 'ウィクショナリー日本語版',
	ascii: 'ASCII.jpデジタル用語辞典',
	binary: 'IT用語辞典バイナリ',
	ewords: 'IT用語辞典 e-Words',
	fideli: 'フィデリ IT用語辞典',
	nicopedia: 'ニコニコ大百科',
};

export const getWordUrl = (word: string, source: DictionarySource, id?: string): string => {
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
		return `http://dic-it.fideli.com/dictionary/m/word/w/${encodeURIComponent(id ?? '')}/index.html`;
	}
	return `http://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
};

export const normalizeMeaning = (input: string): string => {
	let meaning = input;
	meaning = meaning.replace(/[=]= (?<title>.+?) ==/g, '$<title>');
	meaning = meaning.replace(/\(.+?\)/g, '');
	meaning = meaning.replace(/（.+?）/g, '');
	meaning = meaning.replace(/【.+?】/g, '');
	meaning = meaning.replace(/。.*$/, '');
	meaning = meaning.replace(/^.+? -/, '');
	meaning = meaning.replace(/(?:のこと|をいう|である)+$/, '');
	meaning = meaning.replace(/，/g, '、');
	meaning = meaning.replace(/．/g, '。');
	return meaning.trim();
};

export const getMeaning = async ([word, , source, rawMeaning]: WordEntry): Promise<string> => {
	if (source !== 'wikipedia' && source !== 'wiktionary') {
		return rawMeaning ?? '';
	}

	const apiBase = source === 'wikipedia'
		? 'https://ja.wikipedia.org/w/api.php'
		: 'https://ja.wiktionary.org/w/api.php';

	const wikiHeaders = {
		'User-Agent': 'TSGSlackbot/1.0 (https://github.com/tsg-ut/slackbot) tahoiya-bot',
	};

	await axios.post(
		`${apiBase}?${querystring.stringify({action: 'purge', titles: word, format: 'json'})}`,
		{},
		{headers: wikiHeaders},
	).catch((): undefined => undefined);

	let wikitext: string | null = null;
	let exsentences = 0;

	do {
		exsentences++;
		const response = await axios.get(apiBase, {
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
			headers: wikiHeaders,
			responseType: 'json',
		});

		const pages = get(response, ['data', 'query', 'pages']);
		if (typeof pages === 'object') {
			wikitext = get(Object.values(pages), [0, 'extract'], null) as string | null;
		}
	} while (exsentences < 3 && (wikitext === null || wikitext.endsWith('?')));

	if (!wikitext) {
		return '';
	}

	const lines = wikitext.split('\n').filter((line: string) => line.trim().length !== 0);

	let meaning = '';
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

	return meaning.trim();
};
