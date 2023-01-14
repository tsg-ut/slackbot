// @ts-expect-error not typed
import {katakanaRegex} from 'japanese';
import {tokenize, KuromojiToken} from 'kuromojin';
import {last, uniq} from 'lodash';
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
