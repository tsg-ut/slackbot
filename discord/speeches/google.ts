import {v1beta1 as GoogleCloudTextToSpeech} from '@google-cloud/text-to-speech';
import protos from '@google-cloud/text-to-speech/build/protos/protos.js';
const {google} = protos;
import type {SynthesizeFunction} from './types.js';
import {textToSsml} from './util.js';

const {TextToSpeechClient} = GoogleCloudTextToSpeech;

const client = new TextToSpeechClient();

const speech: SynthesizeFunction = async (text: string, voiceType: string, {speed, lang}, audioTags) => {
	const ssml = text.startsWith('<') ? text : `<speak>${textToSsml(text, audioTags)}</speak>`;

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
			google.cloud.texttospeech.v1beta1.SynthesizeSpeechRequest.TimepointType.SSML_MARK,
		],
	});
	const data = Buffer.from(response.audioContent as string, 'binary');

	return {
		data,
		timepoints: response.timepoints,
	};
};

export default speech;
