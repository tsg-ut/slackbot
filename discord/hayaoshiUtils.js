"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchIntroQuizData = exports.formatQuizToSsml = exports.judgeAnswer = exports.extractValidAnswers = void 0;
const assert_1 = __importDefault(require("assert"));
const googleapis_1 = require("googleapis");
// @ts-expect-error not typed
const japanese_1 = require("japanese");
const kuromojin_1 = require("kuromojin");
const lodash_1 = require("lodash");
const hayaoshi_1 = require("../hayaoshi");
// @ts-expect-error not typed
const getReading_js_1 = __importDefault(require("../lib/getReading.js"));
const logger_1 = __importDefault(require("../lib/logger"));
const katakanaMatchRegex = new RegExp(`^(?:${japanese_1.katakanaRegex.source}|ー|・|･)+$`);
const log = logger_1.default.child({ bot: 'hayaoshiUtils' });
const getCompornents = (text) => {
    let mainComponent = text;
    const descriptiveComponents = [];
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
const parseMainComponent = (text) => {
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
const parseSectionWords = (text) => {
    const answers = [];
    let section = text;
    let matches = null;
    if (section.match(/^(?<remnant>.*?)「(?<alternative>.+?)」$/)) {
        while ((matches = section.match(/^(?<remnant>.*?)「(?<alternative>[^」]+?)」$/))) {
            section = matches.groups.remnant.trim();
            answers.push(...parseMainComponent(matches.groups.alternative.trim()));
        }
    }
    else {
        for (const word of section.split(/[、・]/)) {
            answers.push(...parseMainComponent(word.trim()));
        }
    }
    return answers;
};
const parseDescriptiveComponentSection = (text) => {
    if (text.startsWith('×') || text.endsWith('×')) {
        return [];
    }
    const answers = [];
    const section = text.trim();
    let matches = null;
    if (section.match(/(?:◯|○|〇|OK)$/)) {
        if ((matches = section.match(/^(?<body>.+?)(?:もおまけで|のみで|でも|で|も)(?:◯|○|〇|OK)$/))) {
            answers.push(...parseSectionWords(matches.groups.body.trim()));
        }
        else if ((matches = section.match(/^(?:◯|○|〇)(?<body>.+?)$/))) {
            answers.push(...parseSectionWords(matches.groups.body.trim()));
        }
    }
    else if ((matches = section.match(/^(?<body>.+?)はもう一度$/))) {
        answers.push(...parseSectionWords(matches.groups.body.trim()));
    }
    else {
        answers.push(section);
    }
    return answers;
};
const parseDescriptiveComponent = (text) => {
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
const extractValidAnswers = (question, answerText, note = '') => {
    let baseText = answerText;
    // basic normalization
    baseText = baseText.replace(/（/g, '(');
    baseText = baseText.replace(/）/g, ')');
    baseText = baseText.replace(/［/g, '[');
    baseText = baseText.replace(/］/g, ']');
    baseText = baseText.replace(/^\(\d\)/, '');
    baseText = baseText.trim();
    const { mainComponent, descriptiveComponents } = getCompornents(baseText);
    let answers = parseMainComponent(mainComponent);
    for (const component of descriptiveComponents) {
        answers.push(...parseDescriptiveComponent(component));
    }
    answers = answers.filter((answer) => !answer.endsWith('-') && !answer.startsWith('-'));
    const newAnswers = [];
    if (question.match(/(?:誰|だれ)(?:でしょう)?[?？]$/)) {
        for (const answer of answers) {
            if (katakanaMatchRegex.test(answer)) {
                newAnswers.push((0, lodash_1.last)(answer.split(/[・･]/)));
            }
        }
    }
    answers.push(...newAnswers);
    for (const line of note.split('\n')) {
        if (line.length > 0) {
            answers.push(...parseDescriptiveComponent(line));
        }
    }
    return (0, lodash_1.uniq)(answers);
};
exports.extractValidAnswers = extractValidAnswers;
const judgeAnswer = async (validAnswers, answer) => {
    for (const validAnswer of validAnswers) {
        if ((0, hayaoshi_1.isCorrectAnswer)(validAnswer, answer)) {
            return 'correct';
        }
    }
    const validAnswerReadings = await Promise.all(validAnswers.map((text) => (0, getReading_js_1.default)(text)));
    const answerReading = await (0, getReading_js_1.default)(answer);
    for (const validAnswerReading of validAnswerReadings) {
        if (validAnswerReading.length >= 3 && validAnswerReading === answerReading) {
            return 'correct';
        }
    }
    const a = (0, hayaoshi_1.normalize)(answer);
    for (const validAnswer of validAnswers) {
        const b = (0, hayaoshi_1.normalize)(validAnswer);
        if (a.includes(b) || b.includes(a)) {
            return 'onechance';
        }
    }
    return 'incorrect';
};
exports.judgeAnswer = judgeAnswer;
const isFuzokugo = (token) => token.pos === '助詞' || token.pos === '助動詞' || token.pos_detail_1 === '接尾' || token.pos_detail_1 === '非自立';
const formatQuizToSsml = async (text) => {
    const normalizedQuestion = text.replace(/\(.+?\)/g, '').replace(/（.+?）/g, '');
    const tokens = await (0, kuromojin_1.tokenize)(normalizedQuestion);
    const clauses = [];
    for (const [index, token] of tokens.entries()) {
        let prevPos = null;
        let prevForm = null;
        if (index !== 0) {
            prevPos = tokens[index - 1].pos;
            prevForm = tokens[index - 1].surface_form;
        }
        if (clauses.length === 0 || token.pos === '記号' || prevPos === '記号' || token.surface_form === '、' || prevForm === '、') {
            clauses.push(token.surface_form);
        }
        else if (prevPos === '名詞' && token.pos === '名詞') {
            clauses[clauses.length - 1] += token.surface_form;
        }
        else if (isFuzokugo(token)) {
            clauses[clauses.length - 1] += token.surface_form;
        }
        else {
            clauses.push(token.surface_form);
        }
    }
    const components = [];
    let isPrevComponentEnd = false;
    for (const clause of clauses) {
        if (components.length === 0 || isPrevComponentEnd) {
            components.push([clause]);
        }
        else {
            components[components.length - 1].push(clause);
        }
        isPrevComponentEnd = Boolean(clause.match(/[、。?？]$/));
    }
    let spannedQuestionText = '';
    let offset = 0;
    for (const component of components) {
        const componentText = component.join('');
        // eslint-disable-next-line no-loop-func
        const spannedText = component.map((clause, index) => (`${clause}<mark name="c${offset + index}"/>`)).join('');
        offset += component.length;
        if (componentText.endsWith('すが、') || componentText.endsWith('たが、') || componentText.endsWith('対し、')) {
            spannedQuestionText += `<emphasis level="strong"><prosody pitch="+3st">${spannedText}</prosody></emphasis>`;
        }
        else {
            spannedQuestionText += spannedText;
        }
    }
    const ssml = `<speak>${spannedQuestionText}</speak>`;
    return { clauses, ssml };
};
exports.formatQuizToSsml = formatQuizToSsml;
const getSheetRows = (rangeText, sheets) => new Promise((resolve, reject) => {
    sheets.spreadsheets.values.get({
        spreadsheetId: '14zFQH_a8qqPIE2JnxUVMMfkS5YjJ1ltpnYaN7Z3mnjs',
        range: rangeText,
    }, (error, response) => {
        if (error) {
            reject(error);
        }
        else if (response.data.values) {
            resolve(response.data.values);
        }
        else {
            reject(new Error('values not found'));
        }
    });
});
const fetchIntroQuizData = async () => {
    const auth = new googleapis_1.google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth });
    log.info('fetchIntroQuizData - fetching playlists');
    const data = await getSheetRows('playlists!A:ZZ', sheets);
    const maxColumnSize = Math.max(...data.map((row) => row.length));
    (0, assert_1.default)(maxColumnSize % 2 === 0, 'maxColumnSize must be even');
    const playlists = [];
    const songPoolNames = new Set();
    for (const i of Array(maxColumnSize / 2).keys()) {
        const songPools = [];
        const playlistName = data[0][i * 2];
        (0, assert_1.default)(playlistName?.startsWith('$'), 'playlistName must start with $');
        const numberCell = data[0][i * 2 + 1];
        (0, assert_1.default)(numberCell === '#', 'numberCell must be #');
        for (const j of Array(data.length - 1).keys()) {
            const poolName = data[j + 1][i * 2];
            if (!poolName) {
                continue;
            }
            const poolCountCell = data[j + 1][i * 2 + 1];
            if (poolCountCell === '') {
                (0, assert_1.default)(poolName?.startsWith('$'), 'If poolCount is empty, poolName must start with $');
                songPools.push({ name: poolName, count: 0 });
            }
            else {
                (0, assert_1.default)(!poolName?.startsWith('$'), 'If poolCount is not empty, poolName must not start with $');
                const poolCount = parseInt(poolCountCell);
                (0, assert_1.default)(Number.isInteger(poolCount), 'poolCount must be an integer');
                songPoolNames.add(poolName);
                songPools.push({ name: poolName, count: poolCount });
            }
        }
        playlists.push({ name: playlistName, songPools });
    }
    const songPools = [];
    for (const songPoolName of songPoolNames) {
        log.info(`fetchIntroQuizData - fetching ${songPoolName}`);
        const songPoolData = await getSheetRows(`${songPoolName}!A:ZZ`, sheets);
        const songs = [];
        for (const songRow of songPoolData.slice(2)) {
            const [banned = '', title = '', titleRuby = '', artist = '', url = '', introSeconds = '', chorusSeconds = '',] = songRow;
            if (typeof banned === 'string' && banned.length > 0) {
                continue;
            }
            if (url === '') {
                continue;
            }
            (0, assert_1.default)(title !== '', 'title must not be empty');
            (0, assert_1.default)(titleRuby.match(/^[ぁ-んァ-ンゔヴー]*$/), `[${title}] titleRuby must be hiragana or katakana`);
            (0, assert_1.default)(url?.startsWith('https://www.youtube.com/watch?v='), `[${title}] url must be a youtube url`);
            const introSecondsNumber = parseInt(introSeconds);
            (0, assert_1.default)(Number.isInteger(introSecondsNumber), `[${title}] introSeconds must be an integer`);
            const chorusSecondsNumber = parseInt(chorusSeconds);
            (0, assert_1.default)(Number.isInteger(chorusSecondsNumber), `[${title}] chorusSeconds must be an integer`);
            songs.push({ title, titleRuby, artist, url, introSeconds: introSecondsNumber, chorusSeconds: chorusSecondsNumber });
        }
        songPools.push({ name: songPoolName, songs });
    }
    const normalizePlaylist = (playlist, stack = []) => {
        if (stack.includes(playlist.name)) {
            throw new Error(`Circular reference detected: ${[...stack, playlist.name].join(' -> ')}`);
        }
        const songs = [];
        for (const { name: songPoolName, count } of playlist.songPools) {
            if (songPoolName?.startsWith('$')) {
                const subPlaylist = playlists.find(({ name }) => name === songPoolName);
                (0, assert_1.default)(subPlaylist, `subPlaylist ${songPoolName} not found`);
                const subPlaylistSongs = normalizePlaylist(subPlaylist, [...stack, playlist.name]).songs;
                for (const song of subPlaylistSongs) {
                    songs.push(song);
                }
            }
            else {
                const songPool = songPools.find(({ name }) => name === songPoolName);
                (0, assert_1.default)(songPool, `songPool ${songPoolName} not found`);
                for (const song of songPool.songs.slice(0, count)) {
                    songs.push(song);
                }
            }
        }
        return { name: playlist.name, songs: (0, lodash_1.uniqBy)(songs, 'url') };
    };
    const normalizedPlaylists = playlists.map((playlist) => normalizePlaylist(playlist));
    return { playlists: normalizedPlaylists, songPools };
};
exports.fetchIntroQuizData = fetchIntroQuizData;
