const assert = require('assert');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const {promisify} = require('util');
const axios = require('axios');
const download = require('download');
const {hiraganize} = require('japanese');
const get = require('lodash/get');
const last = require('lodash/last');
const shuffle = require('lodash/shuffle');
const moment = require('moment');
const {default: logger} = require('../lib/logger.ts');

const log = logger.child({bot: 'tahoiya'});

module.exports.getPageTitle = (url) => {
	const urlTitle = decodeURI(url.match(/([^/]+)$/)[1]);

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

	assert(url.startsWith('http://dic.nicovideo.jp'));
	return `${urlTitle} - ニコニコ大百科`;
};

module.exports.getWordUrl = (word, source, id) => {
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
		return `http://dic-it.fideli.com/dictionary/m/word/w/${encodeURIComponent(id)}/index.html`;
	}

	assert(source === 'nicopedia');
	return `http://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
};

module.exports.getIconUrl = (source) => {
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

	assert(source === 'nicopedia');
	return 'http://dic.nicovideo.jp/favicon.ico';
};

module.exports.getTimeLink = (time) => {
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

const normalizeMeaning = (input) => {
	let meaning = input;
	meaning = meaning.replace(/== (.+?) ==/g, '$1');
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

module.exports.normalizeMeaning = normalizeMeaning;

module.exports.getMeaning = async ([word, , source, rawMeaning]) => {
	if (source !== 'wikipedia' && source !== 'wiktionary') {
		return rawMeaning;
	}

	let wikitext = null;
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

	let meaning = null;
	const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

	if (lines.length > 1) {
		meaning = source === 'wikipedia' ? lines[1] : last(lines);
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
