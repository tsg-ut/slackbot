"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const microsoft_cognitiveservices_speech_sdk_1 = require("microsoft-cognitiveservices-speech-sdk");
const util_1 = require("./util");
const speech = (text, voiceType, { speed }, audioTags) => {
    const speechConfig = microsoft_cognitiveservices_speech_sdk_1.SpeechConfig.fromSubscription(process.env.AZURE_SUBSCRIPTION_KEY, 'japaneast');
    const synthesizer = new microsoft_cognitiveservices_speech_sdk_1.SpeechSynthesizer(speechConfig);
    return new Promise((resolve, reject) => {
        synthesizer.speakSsmlAsync(`
				<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">
					<voice name="${voiceType}">
						<prosody rate="${speed}">
							${(0, util_1.textToSsml)(text, audioTags)}
						</prosody>
					</voice>
				</speak>
			`, (result) => {
            const { audioData } = result;
            if (!(audioData instanceof ArrayBuffer)) {
                reject(result);
                return;
            }
            synthesizer.close();
            if (result) {
                resolve({ data: Buffer.from(audioData) });
            }
        }, (error) => {
            reject(error);
            synthesizer.close();
        });
    });
};
exports.default = speech;
