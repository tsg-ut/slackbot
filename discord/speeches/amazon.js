"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const util_1 = require("./util");
new aws_sdk_1.default.Config({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'ap-northeast-1',
});
const polly = new aws_sdk_1.default.Polly({
    region: 'ap-northeast-1',
});
const speech = async (text, voiceType, { speed, engine }) => {
    const result = await polly.synthesizeSpeech({
        OutputFormat: 'mp3',
        Text: `
			<speak>
				<prosody rate="${Math.floor(speed * 100)}%">
					${(0, util_1.textToSsml)(text)}
				</prosody>
			</speak>
		`,
        LanguageCode: 'ja-JP',
        TextType: 'ssml',
        VoiceId: voiceType,
        Engine: engine,
    }).promise();
    return { data: result.AudioStream };
};
exports.default = speech;
