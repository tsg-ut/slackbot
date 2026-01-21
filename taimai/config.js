"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    helpTrigger: /^\s*(taimai|たいまい|タイマイ|玳瑁|瑇瑁)/,
    newQuestionTrigger: /^\s*(?:taimai|たいまい|タイマイ|玳瑁|瑇瑁)\s+(?<question>.*(?:\[\].*)*)[?？]$/,
    askTrigger: /[?？]$/,
    answerTrigger: /^[!！]{2}(?<answer>.+)$/,
    surrenderTrigger: /^(投了|降参|終了|矛盾)$/,
    placeholders: [
        '①', '②', '③', '④',
        // 5個以上は多すぎる気がするので今のところ保留
        // '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
    ],
    bannedChars: [
        '①', '②', '③', '④',
        '※',
    ],
    maxConcurrentGame: 5,
    maxQuestionChars: 400,
    maxPieceChars: 20,
    askProbability: 0.6,
    // (max - min) * (1 - 2 / (e^(grow * x) + e^(-grow * x))) + min
    answerProbability: {
        min: 0.01,
        max: 0.8,
        grow: 0.1,
    },
    ultimateAnswer: 'この問題は何かがおかしい。それこそが答えなのだ。(投了)',
};
