import { AteQuizProblem, AteQuiz } from '../atequiz';
import { SlackInterface } from '../lib/slack';
import { ChatPostMessageArguments } from '@slack/web-api';
import { sample } from 'lodash';

// A simplified type for the message event to satisfy the linter and compiler.
interface SimpleMessageEvent {
    channel: string;
    text?: string;
    subtype?: string;
    [key: string]: unknown; // Allow other properties
}

const colors = [
    { name: '黒', emoji: '⚫', value: 0, multiplier: 1, tolerance: null },
    { name: '茶', emoji: '🟤', value: 1, multiplier: 10, tolerance: 1 },
    { name: '赤', emoji: '🔴', value: 2, multiplier: 100, tolerance: 2 },
    { name: '橙', emoji: '🟠', value: 3, multiplier: 1000, tolerance: null },
    { name: '黄', emoji: '🟡', value: 4, multiplier: 10000, tolerance: null },
    { name: '緑', emoji: '🟢', value: 5, multiplier: 100000, tolerance: 0.5 },
    { name: '青', emoji: '🔵', value: 6, multiplier: 1000000, tolerance: 0.25 },
    { name: '紫', emoji: '🟣', value: 7, multiplier: 10000000, tolerance: 0.1 },
    { name: '灰', emoji: '⚪', value: 8, multiplier: null, tolerance: 0.05 }, // Using white circle for gray as a substitute
    { name: '白', emoji: '⚪', value: 9, multiplier: null, tolerance: null },
    { name: '金', emoji: '🪙', value: null, multiplier: 0.1, tolerance: 5 },
    { name: '銀', emoji: '🥈', value: null, multiplier: 0.01, tolerance: 10 },
];

const formatValue = (value: number): string => {
    if (value >= 1000000) {
        return `${value / 1000000}MΩ`;
    }
    if (value >= 1000) {
        return `${value / 1000}kΩ`;
    }
    return `${value}Ω`;
};

const generateProblem = (): AteQuizProblem => {
    const channel = process.env.CHANNEL_SANDBOX;
    const band1 = sample(colors.filter(c => c.value !== null && c.value > 0));
    const band2 = sample(colors.filter(c => c.value !== null));
    const multiplier = sample(colors.filter(c => c.multiplier !== null));
    const tolerance = sample(colors.filter(c => c.tolerance !== null));

    const value = (band1.value * 10 + band2.value) * multiplier.multiplier;

    const problemMessage = {
        channel,
        text: `この抵抗器の抵抗値は？\n${band1.emoji}${band2.emoji}${multiplier.emoji}${tolerance.emoji}`,
    };

    const hintMessages: ChatPostMessageArguments[] = [];

    const immediateMessage = {
        channel,
        text: `制限時間は2分です。答えは「1kΩ」のように単位をつけて答えてね。`,
    };

    const solvedMessage = {
        channel,
        text: `<@[[!user]]> 正解:tada:\n答えは *${formatValue(value)}* (誤差±${tolerance.tolerance}%) だよ:laughing:`,
        reply_broadcast: true,
    };

    const unsolvedMessage = {
        channel,
        text: `正解者は出ませんでした:sob:\n答えは *${formatValue(value)}* (誤差±${tolerance.tolerance}%) だよ:cry:`,
        reply_broadcast: true,
    };

    const correctAnswers = [formatValue(value), `${value}Ω`];
    if (value >= 1000000) {
        correctAnswers.push(`${value / 1000000}MΩ`);
    } else if (value >= 1000) {
        correctAnswers.push(`${value / 1000}kΩ`);
    }

    const problem = {
        problemMessage,
        hintMessages,
        immediateMessage,
        solvedMessage,
        unsolvedMessage,
        answerMessage: null,
        correctAnswers,
    } as AteQuizProblem;

    return problem;
};

const postOption = {
    username: '抵抗器当てクイズ (by Gemini CLI)',
    icon_emoji: ':resistor:',
};

export default (slackClients: SlackInterface): void => {
    const { eventClient } = slackClients;

    eventClient.on('message', async (message: SimpleMessageEvent) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (
            message.subtype === 'bot_message' ||
            message.subtype === 'slackbot_response'
        ) {
            return;
        }
        if (!message.text) {
            return;
        }

        if (message.text.match(/^抵抗器当てクイズ$/)) {
            const problem = generateProblem();
            const quiz = new AteQuiz(slackClients, problem, postOption);
            await quiz.start();
        }
    });
};