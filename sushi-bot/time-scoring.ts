import moment from 'moment';

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
		pattern: /^み+めい！*$/,
		startHour: 0,
		startMinute: 0,
		endHour: 3,
		endMinute: 0,
		scoreName: 'mimei',
	},
	{
		pattern: /^あ+け+(がた|方)！*$/,
		startHour: 3,
		startMinute: 0,
		endHour: 6,
		endMinute: 0,
		scoreName: 'akegata',
	},
	{
		pattern: /^あ+さ！*$/,
		startHour: 6,
		startMinute: 0,
		endHour: 9,
		endMinute: 0,
		scoreName: 'asa',
	},
	{
		pattern: /^ご+ぜん+(ちゅう|中)！*$/,
		startHour: 0,
		startMinute: 0,
		endHour: 12,
		endMinute: 0,
		scoreName: 'gozenchu',
	},
	{
		pattern: /^(ひる|昼)！*$/,
		startHour: 10,
		startMinute: 0,
		endHour: 14,
		endMinute: 0,
		scoreName: 'hiru',
	},
	{
		pattern: /^(ひる|昼)+(ごろ|頃)！*$/,
		startHour: 10,
		startMinute: 0,
		endHour: 14,
		endMinute: 0,
		scoreName: 'hirugoro',
	},
	{
		pattern: /^(ひる|昼)+(まえ|前)！*$/,
		startHour: 9,
		startMinute: 0,
		endHour: 12,
		endMinute: 0,
		scoreName: 'hirumae',
	},
	{
		pattern: /^(ひる|昼)+(すぎ|過ぎ)！*$/,
		startHour: 12,
		startMinute: 0,
		endHour: 15,
		endMinute: 0,
		scoreName: 'hirusugi',
	},
	{
		pattern: /^ご+ご！*$/,
		startHour: 12,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'gogo',
	},
	{
		pattern: /^(ゆう|夕)+(がた|方)！*$/,
		startHour: 15,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'yuugata',
	},
	{
		pattern: /^(ゆう|夕)+(こく|刻)！*$/,
		startHour: 15,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'yuukoku',
	},
	{
		pattern: /^(ゆう|夕)+(がた|方)+(まえ|前)！*$/,
		startHour: 15,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'yuugatamae',
	},
	{
		pattern: /^(ゆう|夕)+(がた|方)+(すぎ|過ぎ)！*$/,
		startHour: 18,
		startMinute: 0,
		endHour: 21,
		endMinute: 0,
		scoreName: 'yuugatasugi',
	},
	{
		pattern: /^(よる|夜)+(の)?(はじめ|初め)+(ごろ|頃)！*$/,
		startHour: 18,
		startMinute: 0,
		endHour: 21,
		endMinute: 0,
		scoreName: 'yorunohajimegoro',
	},
	{
		pattern: /^(よる|夜)！*$/,
		startHour: 18,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yoru',
	},
	{
		pattern: /^(よる|夜)+(かん|間)！*$/,
		startHour: 18,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yorukan',
	},
	{
		pattern: /^(よる|夜)+(おそく|遅く)！*$/,
		startHour: 21,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yoruosoku',
	},
	{
		pattern: /^(やはん|夜半)！*$/,
		startHour: 23,
		startMinute: 30,
		endHour: 24,
		endMinute: 30,
		scoreName: 'yahan',
	},
	{
		pattern: /^(やはん|夜半)+(ごろ|頃)！*$/,
		startHour: 23,
		startMinute: 0,
		endHour: 25,
		endMinute: 0,
		scoreName: 'yahangoro',
	},
	{
		pattern: /^(やはん|夜半)+(まえ|前)！*$/,
		startHour: 22,
		startMinute: 0,
		endHour: 24,
		endMinute: 0,
		scoreName: 'yahanmae',
	},
	{
		pattern: /^(やはん|夜半)+(すぎ|過ぎ)！*$/,
		startHour: 0,
		startMinute: 0,
		endHour: 2,
		endMinute: 0,
		scoreName: 'yahansugi',
	},
	{
		pattern: /^(にっ?ちゅう|日中)！*$/,
		startHour: 9,
		startMinute: 0,
		endHour: 18,
		endMinute: 0,
		scoreName: 'nicchu',
	},
];

function normalizeTimeOfDayText(text: string): string {
	return text
		.replace(/\s/gi, '')
		.replace(/ｻ|サ|:(ahokusa|hokusai)-bottom-left:/gi, 'さ')
		.replace(/ｱ|ア|:(ahokusa|hokusai)-top-right:/gi, 'あ')
		.replace(/朝/gi, 'あさ')
		.replace(/未明/gi, 'みめい')
		.replace(/明け方/gi, 'あけがた')
		.replace(/午前中/gi, 'ごぜんちゅう')
		.replace(/昼頃/gi, 'ひるごろ')
		.replace(/昼前/gi, 'ひるまえ')
		.replace(/昼過ぎ/gi, 'ひるすぎ')
		.replace(/昼/gi, 'ひる')
		.replace(/午後/gi, 'ごご')
		.replace(/夕刻/gi, 'ゆうこく')
		.replace(/夕方前/gi, 'ゆうがたまえ')
		.replace(/夕方過ぎ/gi, 'ゆうがたすぎ')
		.replace(/夕方/gi, 'ゆうがた')
		.replace(/夜のはじめ頃/gi, 'よるのはじめごろ')
		.replace(/夜の初め頃/gi, 'よるのはじめごろ')
		.replace(/夜間/gi, 'よるかん')
		.replace(/夜遅く/gi, 'よるおそく')
		.replace(/夜半頃/gi, 'やはんごろ')
		.replace(/夜半前/gi, 'やはんまえ')
		.replace(/夜半過ぎ/gi, 'やはんすぎ')
		.replace(/夜半/gi, 'やはん')
		.replace(/夜/gi, 'よる')
		.replace(/日中/gi, 'にっちゅう')
		.replace(/!|！|:exclamation:|:heavy_exclamation_mark:|:grey_exclamation:|:bangbang:/gi, '！')
		.replace(/sa/gi, 'さ')
		.replace(/a/gi, 'あ')
		.replace(/mi/gi, 'み')
		.replace(/me/gi, 'め')
		.replace(/i/gi, 'い')
		.replace(/ke/gi, 'け')
		.replace(/ga/gi, 'が')
		.replace(/ta/gi, 'た')
		.replace(/go/gi, 'ご')
		.replace(/ze/gi, 'ぜ')
		.replace(/n/gi, 'ん')
		.replace(/chu/gi, 'ちゅう')
		.replace(/hi/gi, 'ひ')
		.replace(/ru/gi, 'る')
		.replace(/ro/gi, 'ろ')
		.replace(/ma/gi, 'ま')
		.replace(/e/gi, 'え')
		.replace(/su/gi, 'す')
		.replace(/gi/gi, 'ぎ')
		.replace(/yu/gi, 'ゆ')
		.replace(/u/gi, 'う')
		.replace(/ko/gi, 'こ')
		.replace(/ku/gi, 'く')
		.replace(/yo/gi, 'よ')
		.replace(/no/gi, 'の')
		.replace(/ha/gi, 'は')
		.replace(/ji/gi, 'じ')
		.replace(/ka/gi, 'か')
		.replace(/o/gi, 'お')
		.replace(/so/gi, 'そ')
		.replace(/ya/gi, 'や')
		.replace(/ni/gi, 'に')
		.replace(/tti/gi, 'っち')
		.replace(/nti/gi, 'んち');
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
	
	const decimalScore = (scoreCurve(decimalHour) / normalizationValue) * 100;
	
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

export function getReactionName(score: number): string {
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
	
	for (const name in scoreNames) {
		const threshold = scoreNames[name];
		if (score >= threshold && threshold > bestScore) {
			bestScore = threshold;
			bestName = name;
		}
	}
	
	return bestName;
}
