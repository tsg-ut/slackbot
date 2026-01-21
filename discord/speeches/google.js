"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const text_to_speech_1 = require("@google-cloud/text-to-speech");
const protos_1 = require("@google-cloud/text-to-speech/build/protos/protos");
const util_1 = require("./util");
const { TextToSpeechClient } = text_to_speech_1.v1beta1;
const client = new TextToSpeechClient();
const speech = async (text, voiceType, { speed, lang }, audioTags) => {
    const ssml = text.startsWith('<') ? text : `<speak>${(0, util_1.textToSsml)(text, audioTags)}</speak>`;
    const [response] = await client.synthesizeSpeech({
        input: {
            ssml,
        },
        voice: {
            languageCode: lang || 'ja-JP',
            name: voiceType,
        },
        audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: speed,
            effectsProfileId: ['headphone-class-device'],
        },
        enableTimePointing: [
            protos_1.google.cloud.texttospeech.v1beta1.SynthesizeSpeechRequest.TimepointType.SSML_MARK,
        ],
    });
    const data = Buffer.from(response.audioContent, 'binary');
    return {
        data,
        timepoints: response.timepoints,
    };
};
exports.default = speech;
