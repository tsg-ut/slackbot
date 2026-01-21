"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemOpenAIClient = void 0;
const openai = {
    chat: {
        completions: {
            create: jest.fn(),
        },
    },
    audio: {
        speech: {
            create: jest.fn(),
        },
    },
};
exports.default = openai;
exports.systemOpenAIClient = {
    chat: {
        completions: {
            create: jest.fn(),
        },
    },
    batches: {
        create: jest.fn(),
        retrieve: jest.fn(),
    },
};
