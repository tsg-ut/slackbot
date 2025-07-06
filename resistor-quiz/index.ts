import { sample } from 'lodash';
import { Mutex } from 'async-mutex';
import { increment } from '../achievements';
import { AteQuiz, typicalMessageTextsGenerator } from '../atequiz';
import { SlackInterface } from '../lib/slack';

const mutex = new Mutex();

type Difficulty = 'easy' | 'hard';

interface ResistorColor {
	name: string;
	value: number;
	emoji: string;
}

const resistorColors: ResistorColor[] = [
	{ name: '黒', value: 0, emoji: '⚫' },
	{ name: '茶', value: 1, emoji: '🟤' },
	{ name: '赤', value: 2, emoji: '🔴' },
	{ name: '橙', value: 3, emoji: '🟠' },
	{ name: '黄', value: 4, emoji: '🟡' },
	{ name: '緑', value: 5, emoji: '🟢' },
	{ name: '青', value: 6, emoji: '🔵' },
	{ name: '紫', value: 7, emoji: '🟣' },
	{ name: '灰', value: 8, emoji: '🩶' },
	{ name: '白', value: 9, emoji: '⚪' },
];

const multiplierColors: ResistorColor[] = [
	{ name: '黒', value: 1, emoji: '⚫' },
	{ name: '茶', value: 10, emoji: '🟤' },
	{ name: '赤', value: 100, emoji: '🔴' },
	{ name: '橙', value: 1000, emoji: '🟠' },
	{ name: '黄', value: 10000, emoji: '🟡' },
	{ name: '緑', value: 100000, emoji: '🟢' },
	{ name: '青', value: 1000000, emoji: '🔵' },
	{ name: '紫', value: 10000000, emoji: '🟣' },
	{ name: '灰', value: 100000000, emoji: '🩶' },
	{ name: '白', value: 1000000000, emoji: '⚪' },
	{ name: '金', value: 0.1, emoji: '🟨' },
	{ name: '銀', value: 0.01, emoji: '🤍' },
];

const toleranceColors: ResistorColor[] = [
	{ name: '茶', value: 1, emoji: '🟤' },
	{ name: '赤', value: 2, emoji: '🔴' },
	{ name: '緑', value: 0.5, emoji: '🟢' },
	{ name: '青', value: 0.25, emoji: '🔵' },
	{ name: '紫', value: 0.1, emoji: '🟣' },
	{ name: '灰', value: 0.05, emoji: '🩶' },
	{ name: '金', value: 5, emoji: '🟨' },
	{ name: '銀', value: 10, emoji: '🤍' },
];

// E24 series base values (1.0 to 9.1)
const e24Values = [
	1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
	3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1
];

const generateResistorProblem = (difficulty: Difficulty = 'easy') => {
	// Select E24 value and appropriate multiplier
	const e24Value = sample(e24Values);
	const e24String = e24Value.toString().replace('.', '');
	
	// Find appropriate digits and multiplier for the E24 value
	let firstDigit: ResistorColor;
	let secondDigit: ResistorColor;
	let multiplier: ResistorColor;
	
	if (e24String.length === 1) {
		// Single digit like 1, 2, etc.
		firstDigit = resistorColors.find(c => c.value === parseInt(e24String[0]));
		secondDigit = resistorColors.find(c => c.value === 0);
		multiplier = sample(multiplierColors.filter(m => m.value >= 1 && m.value <= 10000000));
	} else if (e24String.length === 2) {
		// Two digits like 10, 11, 12, etc.
		firstDigit = resistorColors.find(c => c.value === parseInt(e24String[0]));
		secondDigit = resistorColors.find(c => c.value === parseInt(e24String[1]));
		multiplier = sample(multiplierColors.filter(m => m.value >= 1 && m.value <= 1000000));
	} else {
		// Three digits like 110, 120, etc. (from 1.1, 1.2)
		firstDigit = resistorColors.find(c => c.value === parseInt(e24String[0]));
		secondDigit = resistorColors.find(c => c.value === parseInt(e24String[1]));
		const availableMultipliers = difficulty === 'easy' 
			? multiplierColors.filter(m => m.value >= 1 && m.value <= 100000)
			: multiplierColors.filter(m => m.value >= 0.1 && m.value <= 1000000);
		multiplier = sample(availableMultipliers);
	}
	
	const tolerance = difficulty === 'hard' ? sample(toleranceColors) : sample(toleranceColors.filter(t => t.value >= 1));
	
	const baseValue = firstDigit.value * 10 + secondDigit.value;
	const resistance = baseValue * multiplier.value;
	
	const generateAnswerVariations = (value: number): string[] => {
		const answers: string[] = [];
		
		// Basic formats
		answers.push(`${value}Ω`);
		answers.push(`${value}オーム`);
		answers.push(value.toString());
		
		// Unit conversions
		if (value >= 1000000) {
			const megaValue = value / 1000000;
			answers.push(`${megaValue}MΩ`);
			answers.push(`${megaValue}Mオーム`);
			answers.push(`${megaValue.toFixed(1)}MΩ`);
			answers.push(`${megaValue.toFixed(1)}Mオーム`);
			// Alternative formats
			if (megaValue >= 1) {
				answers.push(`${(value / 1000).toFixed(0)}kΩ`);
				answers.push(`${(value / 1000)}kΩ`);
			}
		} else if (value >= 1000) {
			const kiloValue = value / 1000;
			answers.push(`${kiloValue}kΩ`);
			answers.push(`${kiloValue}kオーム`);
			answers.push(`${kiloValue.toFixed(1)}kΩ`);
			answers.push(`${kiloValue.toFixed(1)}kオーム`);
			// Alternative formats like 24000Ω for 24kΩ
			answers.push(`${value.toFixed(0)}Ω`);
		}
		
		// Additional decimal variations
		if (value % 1 === 0) {
			answers.push(`${value.toFixed(1)}Ω`);
			if (value >= 1000000) {
				answers.push(`${(value / 1000000).toFixed(1)}MΩ`);
			} else if (value >= 1000) {
				answers.push(`${(value / 1000).toFixed(1)}kΩ`);
			}
		}
		
		return [...new Set(answers)]; // Remove duplicates
	};
	
	const formatResistance = (value: number): string => {
		if (value >= 1000000) {
			const megaValue = value / 1000000;
			return megaValue % 1 === 0 ? `${megaValue}MΩ` : `${megaValue.toFixed(1)}MΩ`;
		} else if (value >= 1000) {
			const kiloValue = value / 1000;
			return kiloValue % 1 === 0 ? `${kiloValue}kΩ` : `${kiloValue.toFixed(1)}kΩ`;
		} else {
			return value % 1 === 0 ? `${value}Ω` : `${value.toFixed(1)}Ω`;
		}
	};
	
	const resistanceText = formatResistance(resistance);
	const colorCode = difficulty === 'hard' 
		? `${firstDigit.emoji}${secondDigit.emoji}${multiplier.emoji}${tolerance.emoji}`
		: `${firstDigit.emoji}${secondDigit.emoji}${multiplier.emoji}`;
	
	const correctAnswers = generateAnswerVariations(resistance);
	
	return {
		colorCode,
		resistance,
		resistanceText,
		correctAnswers,
		tolerance: tolerance?.value,
		difficulty,
		colors: {
			first: firstDigit,
			second: secondDigit,
			multiplier,
			tolerance,
		},
	};
};

const postOption = {
	username: '抵抗器当てクイズ (by Claude Code)',
	icon_emoji: '⚡',
};

export default (slackClients: SlackInterface) => {
	const { eventClient, webClient: slack } = slackClients;

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		const { text, channel } = message;

		if (text && text.match(/^抵抗器当てクイズ( (easy|hard))?$/)) {
			if (mutex.isLocked()) {
				slack.chat.postEphemeral({
					channel,
					text: '今クイズ中だよ',
					user: message.user,
				});
				return;
			}

			mutex.runExclusive(async () => {
				const difficultyMatch = text.match(/^抵抗器当てクイズ( (easy|hard))?$/);
				const difficulty: Difficulty = (difficultyMatch?.[2] as Difficulty) || 'easy';
				const problem = generateResistorProblem(difficulty);
				
				const toleranceHint = difficulty === 'hard' 
					? `\n4桁目: ${problem.colors.tolerance.name} (±${problem.colors.tolerance.value}%)`
					: '';
				
				const hintMessages = [
					{
						channel,
						text: '抵抗値の計算方法のヒントだよ！',
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: difficulty === 'hard'
										? '抵抗値の計算方法のヒントだよ！\n1桁目 × 10 + 2桁目 × 倍率 (許容差は無視してOK)'
										: '抵抗値の計算方法のヒントだよ！\n1桁目 × 10 + 2桁目 × 倍率',
								},
							},
						],
					},
					{
						channel,
						text: 'もっと詳しいヒントだよ！',
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `もっと詳しいヒントだよ！\n1桁目: ${problem.colors.first.name} (${problem.colors.first.value})\n2桁目: ${problem.colors.second.name} (${problem.colors.second.value})\n倍率: ${problem.colors.multiplier.name} (×${problem.colors.multiplier.value})${toleranceHint}`,
								},
							},
						],
					},
					{
						channel,
						text: '計算式を教えるよ！',
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `計算式を教えるよ！\n${problem.colors.first.value} × 10 + ${problem.colors.second.value} = ${problem.colors.first.value * 10 + problem.colors.second.value}\n${problem.colors.first.value * 10 + problem.colors.second.value} × ${problem.colors.multiplier.value} = ${problem.resistance}`,
								},
							},
						],
					},
					{
						channel,
						text: '最後のヒントだよ！もうわかるよね？',
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `最後のヒントだよ！もうわかるよね？\n答えは${problem.resistanceText}の近くだよ！`,
								},
							},
						],
					},
				];

				const colorOrderText = difficulty === 'hard' 
					? '色の順番: 1桁目 → 2桁目 → 倍率 → 許容差'
					: '色の順番: 1桁目 → 2桁目 → 倍率';
				
				const problemText = difficulty === 'hard'
					? `この抵抗器の抵抗値は何Ωでしょう？ (${difficulty}モード)\n${problem.colorCode}`
					: `この抵抗器の抵抗値は何Ωでしょう？ (${difficulty}モード)\n${problem.colorCode}`;

				const ateQuiz = new AteQuiz(slackClients, {
					problemMessage: {
						channel,
						text: problemText,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: problemText,
								},
							},
							{
								type: 'context',
								elements: [
									{
										type: 'mrkdwn',
										text: colorOrderText,
									},
								],
							},
						],
					},
					hintMessages,
					immediateMessage: {
						channel,
						text: '15秒経過でヒントを出すよ♫',
					},
					solvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.solved(problem.resistanceText),
					},
					unsolvedMessage: {
						channel,
						text: typicalMessageTextsGenerator.unsolved(problem.resistanceText),
					},
					answerMessage: {
						channel,
						text: `答えは${problem.resistanceText}だよ！`,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: difficulty === 'hard'
										? `答えは${problem.resistanceText}だよ！\n${problem.colorCode}\n\n計算式:\n${problem.colors.first.name}${problem.colors.first.emoji} (${problem.colors.first.value}) × 10 + ${problem.colors.second.name}${problem.colors.second.emoji} (${problem.colors.second.value}) = ${problem.colors.first.value * 10 + problem.colors.second.value}\n${problem.colors.first.value * 10 + problem.colors.second.value} × ${problem.colors.multiplier.name}${problem.colors.multiplier.emoji} (×${problem.colors.multiplier.value}) = ${problem.resistance}Ω\n許容差: ${problem.colors.tolerance.name}${problem.colors.tolerance.emoji} (±${problem.colors.tolerance.value}%)`
										: `答えは${problem.resistanceText}だよ！\n${problem.colorCode}\n\n計算式:\n${problem.colors.first.name}${problem.colors.first.emoji} (${problem.colors.first.value}) × 10 + ${problem.colors.second.name}${problem.colors.second.emoji} (${problem.colors.second.value}) = ${problem.colors.first.value * 10 + problem.colors.second.value}\n${problem.colors.first.value * 10 + problem.colors.second.value} × ${problem.colors.multiplier.name}${problem.colors.multiplier.emoji} (×${problem.colors.multiplier.value}) = ${problem.resistance}Ω`,
								},
							},
						],
					},
					correctAnswers: problem.correctAnswers,
				}, postOption);

				const result = await ateQuiz.start();

				if (result.state === 'solved') {
					await increment(result.correctAnswerer, 'resistor-quiz-answer');
					
					if (difficulty === 'easy') {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-easy');
					} else {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-hard');
					}
					
					if (result.hintIndex === 0) {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-no-hint');
					}
					
					if (result.hintIndex <= 1) {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-first-hint');
					}
					
					if (problem.resistance >= 1000000) {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-mega-ohm');
					}
					
					if (problem.resistance >= 1000) {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-kilo-ohm');
					}
					
					if (problem.resistance < 100) {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-low-resistance');
					}
					
					// E24 series specific achievements
					await increment(result.correctAnswerer, 'resistor-quiz-answer-e24');
					
					if (difficulty === 'hard' && problem.tolerance <= 1) {
						await increment(result.correctAnswerer, 'resistor-quiz-answer-precision-resistor');
					}
				}
			});
		}
	});
};