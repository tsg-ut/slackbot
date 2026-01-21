"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../lib/logger"));
const log = logger_1.default.child({ bot: 'discord' });
const voiceMapping = {
    metan: {
        normal: 0,
        happiness: 2,
        anger: 4,
        sadness: 6,
    },
    zundamon: {
        normal: 1,
        happiness: 3,
        anger: 5,
        sadness: 7,
    },
    tsumugi: {
        normal: 8,
    },
    ritsu: {
        normal: 9,
    },
    hau: {
        normal: 10,
    },
    takehiro: {
        normal: 11,
    },
    torataro: {
        normal: 12,
    },
    ryusei: {
        normal: 13,
    },
    himari: {
        normal: 14,
    },
    sora: {
        normal: 15,
        hapiness: 16,
        anger: 17,
        sadness: 18,
    },
    sora_whisper: {
        normal: 19,
    },
    mochiko: {
        normal: 20,
    },
    kenzaki: {
        normal: 21,
    },
    zunda_whisper: {
        normal: 22,
    },
    whitecul: {
        normal: 23,
        hapiness: 24,
        anger: 25,
        sadness: 26,
    },
    goki: {
        normal: 27,
        hapiness: 28,
    },
    number7: {
        normal: 29,
        hapiness: 30,
        anger: 31,
    },
};
const speech = (text, voiceType, { speed, emotion }) => {
    const emoDict = voiceMapping[voiceType];
    const postData = {
        text,
        speaker: emoDict[emotion || 'normal'] || emoDict.normal,
        speed: 1.0 + (speed - 1.0) / 2,
    };
    return new Promise((resolve, reject) => {
        axios_1.default.post(process.env.VOICEVOX_API_URL, postData, {
            headers: {
                'content-type': 'application/json',
            },
            responseType: 'arraybuffer',
        }).then((response) => {
            resolve({ data: response.data });
        }).catch((reason) => {
            log.error(`The VoiceVox API server has returned an error: ${reason.response?.data?.toString()}`);
            reject(reason);
        });
    });
};
exports.default = speech;
