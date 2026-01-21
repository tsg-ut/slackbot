"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = __importDefault(require("../../lib/openai"));
const speech = async (text, voiceType, options, audioTags) => {
    const mp3 = await openai_1.default.audio.speech.create({
        model: options.engine ?? 'tts-1',
        voice: voiceType,
        input: text,
        instructions: 'You are a native Japanese speaker. If the given text is entirely in kanji and you are not sure whether it is Japanese or Chinese, read it in Japanese.\nTone: Emotionless, flat, calm like an announcer',
    });
    return {
        data: Buffer.from(mp3.data),
    };
};
exports.default = speech;
