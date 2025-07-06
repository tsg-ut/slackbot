import { sample } from 'lodash';
import { Mutex } from 'async-mutex';
import { increment } from '../achievements';
import { AteQuiz, typicalMessageTextsGenerator } from '../atequiz';
import { SlackInterface } from '../lib/slack';

const mutex = new Mutex();

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
	{ name: '灰', value: 8, emoji: '⚪' },
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
	{ name: '金', value: 0.1, emoji: '🟨' },
	{ name: '銀', value: 0.01, emoji: '🤍' },
];

const generateResistorProblem = () => {
	const firstDigit = sample(resistorColors.slice(1));
	const secondDigit = sample(resistorColors);
	const multiplier = sample(multiplierColors);
	
	const baseValue = firstDigit.value * 10 + secondDigit.value;
	const resistance = baseValue * multiplier.value;
	
	const formatResistance = (value: number): string => {
		if (value >= 1000000) {
			return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}MΩ`;
		} else if (value >= 1000) {
			return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}kΩ`;
		} else {
			return `${value}Ω`;
		}
	};
	
	const resistanceText = formatResistance(resistance);
	const colorCode = `${firstDigit.emoji}${secondDigit.emoji}${multiplier.emoji}`;
	
	const correctAnswers = [
		resistanceText,
		`${resistance}Ω`,
		`${resistance}オーム`,
		resistance.toString(),
	];
	
	return {
		colorCode,
		resistance,
		resistanceText,
		correctAnswers,
		colors: {
			first: firstDigit,
			second: secondDigit,
			multiplier,
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

		if (text && text.match(/^抵抗器当てクイズ$/)) {
			if (mutex.isLocked()) {
				slack.chat.postEphemeral({
					channel,
					text: '今クイズ中だよ',
					user: message.user,
				});
				return;
			}

			mutex.runExclusive(async () => {
				const problem = generateResistorProblem();
				
				const hintMessages = [
					{
						channel,
						text: '抵抗値の計算方法のヒントだよ！',
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: '抵抗値の計算方法のヒントだよ！\n1桁目 × 10 + 2桁目 × 倍率',
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
									text: `もっと詳しいヒントだよ！\n1桁目: ${problem.colors.first.name} (${problem.colors.first.value})\n2桁目: ${problem.colors.second.name} (${problem.colors.second.value})\n倍率: ${problem.colors.multiplier.name} (×${problem.colors.multiplier.value})`,
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

				const ateQuiz = new AteQuiz(slackClients, {
					problemMessage: {
						channel,
						text: `この抵抗器の抵抗値は何Ωでしょう？\n${problem.colorCode}`,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `この抵抗器の抵抗値は何Ωでしょう？\n${problem.colorCode}`,
								},
							},
							{
								type: 'context',
								elements: [
									{
										type: 'mrkdwn',
										text: '色の順番: 1桁目 → 2桁目 → 倍率',
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
									text: `答えは${problem.resistanceText}だよ！\n${problem.colorCode}\n\n計算式:\n${problem.colors.first.name}${problem.colors.first.emoji} (${problem.colors.first.value}) × 10 + ${problem.colors.second.name}${problem.colors.second.emoji} (${problem.colors.second.value}) = ${problem.colors.first.value * 10 + problem.colors.second.value}\n${problem.colors.first.value * 10 + problem.colors.second.value} × ${problem.colors.multiplier.name}${problem.colors.multiplier.emoji} (×${problem.colors.multiplier.value}) = ${problem.resistance}Ω`,
								},
							},
						],
					},
					correctAnswers: problem.correctAnswers,
				}, postOption);

				const result = await ateQuiz.start();

				if (result.state === 'solved') {
					await increment(result.correctAnswerer, 'resistor-quiz-answer');
					
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
				}
			});
		}
	});
};