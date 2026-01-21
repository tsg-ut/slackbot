"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Emotion = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../lib/logger"));
var Emotion;
(function (Emotion) {
    Emotion["normal"] = "normal";
    Emotion["happiness"] = "happiness";
    Emotion["anger"] = "anger";
    Emotion["sadness"] = "sadness";
})(Emotion || (exports.Emotion = Emotion = {}));
const log = logger_1.default.child({ bot: 'discord' });
const speech = (text, voiceType, { speed, emotion, emolv }) => {
    const postData = new URLSearchParams({
        text,
        speaker: voiceType,
        speed: Math.floor(speed * 100).toString(),
        pitch: '100',
        volume: '100',
        format: 'mp3',
        // for other options, see https://cloud.voicetext.jp/webapi/docs/api
    });
    if (emotion && emolv && voiceType !== 'show' && emotion !== Emotion.normal) {
        postData.set('emotion', emotion);
        postData.set('emotion_level', emolv.toString());
    }
    return new Promise((resolve, reject) => {
        axios_1.default.post('https://api.voicetext.jp/v1/tts', Buffer.from(postData.toString()), {
            auth: {
                username: process.env.VOICETEXT_API_KEY,
                password: '',
            },
            responseType: 'arraybuffer',
        }).then((response) => {
            resolve({ data: response.data });
        }).catch((reason) => {
            if (axios_1.default.isAxiosError(reason)) {
                log.error(`The VoiceText API server has returned an error: ${reason.response?.data}`);
            }
            reject(reason);
        });
    });
};
exports.default = speech;
