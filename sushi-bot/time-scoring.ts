import moment from 'moment';
import wanakana from 'wanakana';
// @ts-expect-error: Not typed
import {hiraganize} from 'japanese';

export interface TimeOfDay {
	pattern: RegExp;
	startHour: number;
	startMinute: number;
	endHour: number;
	endMinute: number;
	scoreName: string;
}

export const timeOfDayDefinitions: TimeOfDay[] = [
	{
		pattern: /^(みめい|未明)$/,
		startHour: 0,
		startMinute: 0,
		endHour: 3,
		endMinute: 0,
		scoreName: 'mimei',
	},
	{
		pattern: /^(あけがた|明け方)$/,
		startHour: 3,
		startMinute: 0,
		endHour: 6,
		endMinute: 0,
		scoreName: 'akegata',
	},
	{
		pattern: /^あ+さ$/,
		startHour: 6,
		startMinute: 0,
		endHour: 9,
		endMinute: 0,
		scoreName: 'asa',
	},
	{
		pattern: /^(ごぜんちゅう|午前中)$/,
		startHour: 0,
		startMinute: 0,
		endHour: 12,
		endMinute: 0,
		scoreName: 'gozenchu',
	},
	{
		pattern: /^(ひるごろ|昼頃)$/,
		startHour: 10,
		startMinute: 0,
		endHour: 14,
		endMinute: 0,
		scoreName: 'hirugoro',
	},
	{
		pattern: /^(ひるまえ|昼前)$/,
		startHour: 9,
		startMinute: 0,
		endHour: 12,
		endMinute: 0,
		scoreName: 'hirumae',
	},
	{
		pattern: /^(ひるすぎ|昼過ぎ)$/,
		startHour: 12,
		startMinute: 0,
		endHour: 15,
		endMinute: 0,
		scoreName: 'hirusugi',
	},
	{
		pattern: /^(ひる|昼)$/,
		startHour: 10,
		startMinute: 0,
		endHour: 14,
		endMinute: 0,
		scoreName: 'hiru',
	},
	{
		pattern: /^(ごご|午後)$/,
		startHour: 12,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'gogo',
	},
	{
		pattern: /^(ゆうがたまえ|夕方前)$/,
		startHour: 15,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'yuugatamae',
	},
	{
		pattern: /^(ゆうがたすぎ|夕方過ぎ)$/,
		startHour: 18,
		startMinute: 0,
		endHour: 21,
		endMinute: 0,
		scoreName: 'yuugatasugi',
	},
	{
		pattern: /^(ゆうがた|夕方)$/,
		startHour: 15,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'yuugata',
	},
	{
		pattern: /^(ゆうこく|夕刻)$/,
		startHour: 15,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'yuukoku',
	},
	{
		pattern: /^(よるのはじめごろ|夜のはじめ頃|夜の初め頃)$/,
		startHour: 18,
		startMinute: 0,
		endHour: 21,
		endMinute: 0,
		scoreName: 'yorunohajimegoro',
	},
	{
		pattern: /^(よるおそく|夜遅く)$/,
		startHour: 21,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yoruosoku',
	},
	{
		pattern: /^(やかん|夜間)$/,
		startHour: 18,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yorukan',
	},
	{
		pattern: /^(よる|夜)$/,
		startHour: 18,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yoru',
	},
	{
		pattern: /^(やはんごろ|夜半頃)$/,
		startHour: 23,
		startMinute: 0,
		endHour: 25,
		endMinute: 0,
		scoreName: 'yahangoro',
	},
	{
		pattern: /^(やはんまえ|夜半前)$/,
		startHour: 22,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yahanmae',
	},
	{
		pattern: /^(やはんすぎ|夜半過ぎ)$/,
		startHour: 0,
		startMinute: 0,
		endHour: 2,
		endMinute: 0,
		scoreName: 'yahansugi',
	},
	{
		pattern: /^(やはん|夜半)$/,
		startHour: 23,
		startMinute: 30,
		endHour: 24,
		endMinute: 30,
		scoreName: 'yahan',
	},
	{
		pattern: /^(にっちゅう|日中)$/,
		startHour: 9,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'nicchu',
	},
];

function normalizeTimeOfDayText(text: string): string {
	// Remove whitespace
	let normalized = text.replace(/\s/g, '');
	
	// NFKC normalization
	normalized = normalized.normalize('NFKC');
	
	// Handle special emoji patterns for "asa" (from original code) - BEFORE romaji conversion
	normalized = normalized
		.replace(/ｻ|サ|:(ahokusa|hokusai)-bottom-left:/gi, 'さ')
		.replace(/ｱ|ア|:(ahokusa|hokusai)-top-right:/gi, 'あ')
		.replace(/朝/gi, 'あさ');
	
	// Convert romaji to kana
	normalized = wanakana.toKana(normalized);
	
	// Convert katakana to hiragana
	normalized = hiraganize(normalized);
	
	// Remove trailing exclamation marks and similar punctuation
	normalized = normalized.replace(/(?:!|！|:exclamation:|:heavy_exclamation_mark:|:grey_exclamation:|:bangbang:)+$/g, '');
	
	return normalized;
}

function calculateTimeScore(
	currentHour: number,
	currentMinute: number,
	currentSecond: number,
	startHour: number,
	startMinute: number,
	endHour: number,
	endMinute: number
): number {
	const decimalHour = currentHour + currentMinute / 60 + currentSecond / 3600;
	
	const startDecimal = startHour + startMinute / 60;
	const endDecimal = endHour + endMinute / 60;
	
	const center = (startDecimal + endDecimal) / 2;
	
	const scoreCurve = (t: number) => Math.cos((t - center) / 24 * 2 * Math.PI);
	const normalizationValue = scoreCurve(endDecimal);
	
	if (normalizationValue === 0) {
		return 0;
	}
	
	// If the time period crosses midnight (endHour >= 24), adjust currentHour
	let adjustedDecimalHour = decimalHour;
	if (endHour >= 24 && decimalHour < 12) {
		// Current time is in the early morning (after midnight), add 24 to treat it as next day
		adjustedDecimalHour = decimalHour + 24;
	}
	
	const decimalScore = (scoreCurve(adjustedDecimalHour) / normalizationValue) * 100;
	
	return decimalScore;
}

export function scoreTimeOfDay(text: string): {matched: boolean; scoreName: string; score: number} | null {
	const normalizedText = normalizeTimeOfDayText(text);
	
	for (const definition of timeOfDayDefinitions) {
		if (definition.pattern.test(normalizedText)) {
			const now = moment().utcOffset('+0900');
			const currentHour = now.hour();
			const currentMinute = now.minutes();
			const currentSecond = now.seconds();
			
			const score = calculateTimeScore(
				currentHour,
				currentMinute,
				currentSecond,
				definition.startHour,
				definition.startMinute,
				definition.endHour,
				definition.endMinute
			);
			
			return {
				matched: true,
				scoreName: definition.scoreName,
				score,
			};
		}
	}
	
	return null;
}

export function getReactionName(score: number): {name: string, score: number} {
	const scoreNames: {[index: string]: number} = {
		'0ten': 0,
		'5ten': 5,
		'20': 20,
		'50': 50,
		'80': 80,
		'95': 95,
		'100': 100,
		'108': 108,
	};
	
	let bestScore = 0;
	let bestName = '0ten';
	
	for (const [name, threshold] of Object.entries(scoreNames)) {
		if (score >= threshold && threshold > bestScore) {
			bestScore = threshold;
			bestName = name;
		}
	}
	
	return {name: bestName, score: bestScore};
}
