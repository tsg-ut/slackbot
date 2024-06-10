import assert from 'assert';
import {google, sheets_v4} from 'googleapis';
// @ts-expect-error not typed
import {katakanaRegex} from 'japanese';
import {tokenize, KuromojiToken} from 'kuromojin';
import {last, uniq, uniqBy} from 'lodash';
import {isCorrectAnswer, normalize} from '../hayaoshi';
// @ts-expect-error not typed
import getReading from '../lib/getReading.js';

const katakanaMatchRegex = new RegExp(`^(?:${katakanaRegex.source}|ー|・|･)+$`);

const getCompornents = (text: string) => {
	let mainComponent = text;
	const descriptiveComponents: string[] = [];

	while (mainComponent.match(/【.+?】/)) {
		const matches = mainComponent.match(/^(?<main>.*)【(?<description>.+?)】(?<suffix>.*?)$/);
		mainComponent = matches?.groups.main;
		descriptiveComponents.push(matches?.groups.description);
		if (matches?.groups.suffix.length > 0) {
			descriptiveComponents.push(matches?.groups.suffix);
		}
	}

	while (mainComponent.includes('※')) {
		const matches = mainComponent.match(/^(?<main>.*)※(?<description>[^※]*)$/);
		mainComponent = matches?.groups.main;
		descriptiveComponents.push(matches?.groups.description);
	}

	return {
		mainComponent: mainComponent.trim(),
		descriptiveComponents: descriptiveComponents.map((component) => component.trim()),
	};
};

const parseMainComponent = (text: string) => {
	let component = text.trim();
	let matches = null;
	const answers = [];
	let matched = true;
	while (matched) {
		matched = false;
		if ((matches = component.match(/^(?<remnant>.*?)\((?<alternative>.+?)\)$/))) {
			component = matches.groups.remnant.trim();
			answers.push(...matches.groups.alternative.trim().split(/[、,:]/).map((w) => w.trim()));
			matched = true;
		}
		if ((matches = component.match(/^(?<remnant>.*?)\[(?<alternative>.+?)\]$/))) {
			component = matches.groups.remnant.trim();
			answers.push(...matches.groups.alternative.trim().split(/[、,:]/).map((w) => w.trim()));
			matched = true;
		}
	}
	if ((matches = component.match(/^\((?<prefix>.+?)\)(?<remnant>.*?)$/))) {
		component = matches.groups.remnant;
		answers.push(matches.groups.prefix.trim() + matches.groups.remnant.trim());
	}
	answers.unshift(component.replace(/\s*\(.+?\)\s*/g, '').trim());
	return answers;
};

const parseSectionWords = (text: string) => {
	const answers = [];
	let section = text;
	let matches = null;

	if (section.match(/^(?<remnant>.*?)「(?<alternative>.+?)」$/)) {
		while ((matches = section.match(/^(?<remnant>.*?)「(?<alternative>[^」]+?)」$/))) {
			section = matches.groups.remnant.trim();
			answers.push(...parseMainComponent(matches.groups.alternative.trim()));
		}
	} else {
		for (const word of section.split(/[、・]/)) {
			answers.push(...parseMainComponent(word.trim()));
		}
	}
	return answers;
};

const parseDescriptiveComponentSection = (text: string) => {
	if (text.startsWith('×') || text.endsWith('×')) {
		return [];
	}

	const answers = [];
	const section = text.trim();
	let matches = null;
	if (section.match(/(?:◯|○|〇|OK)$/)) {
		if ((matches = section.match(/^(?<body>.+?)(?:もおまけで|のみで|でも|で|も)(?:◯|○|〇|OK)$/))) {
			answers.push(...parseSectionWords(matches.groups.body.trim()));
		} else if ((matches = section.match(/^(?:◯|○|〇)(?<body>.+?)$/))) {
			answers.push(...parseSectionWords(matches.groups.body.trim()));
		}
	} else if ((matches = section.match(/^(?<body>.+?)はもう一度$/))) {
		answers.push(...parseSectionWords(matches.groups.body.trim()));
	} else {
		answers.push(section);
	}
	return answers;
};

const parseDescriptiveComponent = (text: string) => {
	let component = text.trim();
	const answers = [];
	if (component.startsWith('※')) {
		component = component.slice(1);
	}
	if (component.startsWith('△')) {
		component = component.slice(1);
	}
	if (component.match(/^[英独仏羅西伊露瑞西][:：]/)) {
		component = component.slice(2);
	}
	const sections = component.split(/[、。/,:]/);
	for (const section of sections) {
		answers.push(...parseDescriptiveComponentSection(section));
	}
	return answers;
};

export const extractValidAnswers = (question: string, answerText: string, note = '') => {
	let baseText = answerText;

	// basic normalization
	baseText = baseText.replace(/（/g, '(');
	baseText = baseText.replace(/）/g, ')');
	baseText = baseText.replace(/［/g, '[');
	baseText = baseText.replace(/］/g, ']');
	baseText = baseText.replace(/^\(\d\)/, '');
	baseText = baseText.trim();

	const {mainComponent, descriptiveComponents} = getCompornents(baseText);

	let answers = parseMainComponent(mainComponent);

	for (const component of descriptiveComponents) {
		answers.push(...parseDescriptiveComponent(component));
	}

	answers = answers.filter((answer) => !answer.endsWith('-') && !answer.startsWith('-'));

	const newAnswers = [];
	if (question.match(/(?:誰|だれ)(?:でしょう)?[?？]$/)) {
		for (const answer of answers) {
			if (katakanaMatchRegex.test(answer)) {
				newAnswers.push(last(answer.split(/[・･]/)));
			}
		}
	}

	answers.push(...newAnswers);

	for (const line of note.split('\n')) {
		if (line.length > 0) {
			answers.push(...parseDescriptiveComponent(line));
		}
	}

	return uniq(answers);
};

export const judgeAnswer = async (validAnswers: string[], answer: string) => {
	for (const validAnswer of validAnswers) {
		if (isCorrectAnswer(validAnswer, answer)) {
			return 'correct';
		}
	}

	const validAnswerReadings: string[] = await Promise.all(validAnswers.map((text) => getReading(text)));
	const answerReading: string = await getReading(answer);

	for (const validAnswerReading of validAnswerReadings) {
		if (validAnswerReading.length >= 3 && validAnswerReading === answerReading) {
			return 'correct';
		}
	}

	const a = normalize(answer);
	for (const validAnswer of validAnswers) {
		const b = normalize(validAnswer);
		if (a.includes(b) || b.includes(a)) {
			return 'onechance';
		}
	}

	return 'incorrect';
};
const isFuzokugo = (token: KuromojiToken) => token.pos === '助詞' || token.pos === '助動詞' || token.pos_detail_1 === '接尾' || token.pos_detail_1 === '非自立';

export const formatQuizToSsml = async (text: string) => {
	const normalizedQuestion = text.replace(/\(.+?\)/g, '').replace(/（.+?）/g, '');

	const tokens = await tokenize(normalizedQuestion);

	const clauses: string[] = [];
	for (const [index, token] of tokens.entries()) {
		let prevPos: string = null;
		let prevForm: string = null;
		if (index !== 0) {
			prevPos = tokens[index - 1].pos;
			prevForm = tokens[index - 1].surface_form;
		}
		if (clauses.length === 0 || token.pos === '記号' || prevPos === '記号' || token.surface_form === '、' || prevForm === '、') {
			clauses.push(token.surface_form);
		} else if (prevPos === '名詞' && token.pos === '名詞') {
			clauses[clauses.length - 1] += token.surface_form;
		} else if (isFuzokugo(token)) {
			clauses[clauses.length - 1] += token.surface_form;
		} else {
			clauses.push(token.surface_form);
		}
	}

	const components: string[][] = [];
	let isPrevComponentEnd = false;
	for (const clause of clauses) {
		if (components.length === 0 || isPrevComponentEnd) {
			components.push([clause]);
		} else {
			components[components.length - 1].push(clause);
		}
		isPrevComponentEnd = Boolean(clause.match(/[、。?？]$/));
	}

	let spannedQuestionText = '';
	let offset = 0;

	for (const component of components) {
		const componentText = component.join('');
		// eslint-disable-next-line no-loop-func
		const spannedText = component.map((clause, index) => (
			`${clause}<mark name="c${offset + index}"/>`
		)).join('');
		offset += component.length;
		if (componentText.endsWith('すが、') || componentText.endsWith('たが、') || componentText.endsWith('対し、')) {
			spannedQuestionText += `<emphasis level="strong"><prosody pitch="+3st">${spannedText}</prosody></emphasis>`;
		} else {
			spannedQuestionText += spannedText;
		}
	}

	const ssml = `<speak>${spannedQuestionText}</speak>`;

	return {clauses, ssml};
};

const getSheetRows = (rangeText: string, sheets: sheets_v4.Sheets) => new Promise<string[][]>((resolve, reject) => {
	sheets.spreadsheets.values.get({
		spreadsheetId: '14zFQH_a8qqPIE2JnxUVMMfkS5YjJ1ltpnYaN7Z3mnjs',
		range: rangeText,
	}, (error, response) => {
		if (error) {
			reject(error);
		} else if (response.data.values) {
			resolve(response.data.values as string[][]);
		} else {
			reject(new Error('values not found'));
		}
	});
});

interface Song {
	title: string,
	titleRuby: string,
	artist: string,
	url: string,
	introSeconds: number,
	chorusSeconds: number,
}

interface SongPool {
	name: string,
	songs: Song[],
}

interface SongPoolEntry {
	name: string,
	count: number,
}

interface Playlist {
	name: string,
	songPools: SongPoolEntry[],
}

interface NormalizedPlaylist {
	name: string,
	songs: Song[],
}

export const fetchIntroQuizData = async () => {
	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const data = await getSheetRows('playlists!A:ZZ', sheets);
	const maxColumnSize = Math.max(...data.map((row) => row.length));

	assert(maxColumnSize % 2 === 0, 'maxColumnSize must be even');

	const playlists: Playlist[] = [];
	const songPoolNames: Set<string> = new Set();

	for (const i of Array(maxColumnSize / 2).keys()) {
		const songPools = [];

		const playlistName = data[0][i * 2];
		assert(playlistName?.startsWith('$'), 'playlistName must start with $');

		const numberCell = data[0][i * 2 + 1];
		assert(numberCell === '#', 'numberCell must be #');

		for (const j of Array(data.length - 1).keys()) {
			const poolName = data[j + 1][i * 2];
			if (!poolName) {
				continue;
			}

			const poolCountCell = data[j + 1][i * 2 + 1];
			if (poolCountCell === '') {
				assert(poolName?.startsWith('$'), 'If poolCount is empty, poolName must start with $');
				songPools.push({name: poolName, count: 0});
			} else {
				assert(!poolName?.startsWith('$'), 'If poolCount is not empty, poolName must not start with $');

				const poolCount = parseInt(poolCountCell);
				assert(Number.isInteger(poolCount), 'poolCount must be an integer');

				songPoolNames.add(poolName);

				songPools.push({name: poolName, count: poolCount});
			}
		}

		playlists.push({name: playlistName, songPools});
	}

	const songPools: SongPool[] = [];

	for (const songPoolName of songPoolNames) {
		const songPoolData = await getSheetRows(`${songPoolName}!A:ZZ`, sheets);
		const maxSongColumnSize = Math.max(...songPoolData.map((row) => row.length));

		assert(maxSongColumnSize === 6, 'maxSongColumnSize must be 6');

		const songs: Song[] = [];

		for (const songRow of songPoolData.slice(2)) {
			const [title, titleRuby, artist, url, introSeconds, chorusSeconds] = songRow;

			assert(title !== '', 'title must not be empty');
			assert(titleRuby.match(/^[ぁ-んァ-ンー]+$/), 'titleRuby must be hiragana or katakana');
			assert(url?.startsWith('https://www.youtube.com/watch?v='), 'url must be a YouTube URL');

			const introSecondsNumber = parseInt(introSeconds);
			assert(Number.isInteger(introSecondsNumber), 'introSeconds must be an integer');

			const chorusSecondsNumber = parseInt(chorusSeconds);
			assert(Number.isInteger(chorusSecondsNumber), 'chorusSeconds must be an integer');

			songs.push({title, titleRuby, artist, url, introSeconds: introSecondsNumber, chorusSeconds: chorusSecondsNumber});
		}

		songPools.push({name: songPoolName, songs});
	}

	const normalizePlaylist = (playlist: Playlist, stack: string[] = []): NormalizedPlaylist => {
		if (stack.includes(playlist.name)) {
			throw new Error(`Circular reference detected: ${[...stack, playlist.name].join(' -> ')}`);
		}

		const songs: Song[] = [];

		for (const {name: songPoolName, count} of playlist.songPools) {
			if (songPoolName?.startsWith('$')) {
				const subPlaylist = playlists.find(({name}) => name === songPoolName);
				assert(subPlaylist, `subPlaylist ${songPoolName} not found`);

				const subPlaylistSongs = normalizePlaylist(subPlaylist, [...stack, playlist.name]).songs;
				for (const song of subPlaylistSongs) {
					songs.push(song);
				}
			} else {
				const songPool = songPools.find(({name}) => name === songPoolName);
				assert(songPool, `songPool ${songPoolName} not found`);

				for (const song of songPool.songs.slice(0, count)) {
					songs.push(song);
				}
			}
		}

		return {name: playlist.name, songs: uniqBy(songs, 'url')};
	};

	const normalizedPlaylists = playlists.map((playlist) => normalizePlaylist(playlist));

	return normalizedPlaylists;
};


export {NormalizedPlaylist as IntroQuizPlaylist, Song as IntroQuizSong};
