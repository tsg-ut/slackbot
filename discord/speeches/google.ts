import {v1beta1 as GoogleCloudTextToSpeech} from '@google-cloud/text-to-speech';
import {google} from '@google-cloud/text-to-speech/build/protos/protos';
import {SynthesizeFunction} from './types.d';
import {textToSsml} from './util';

const {TextToSpeechClient} = GoogleCloudTextToSpeech;

const client = new TextToSpeechClient();

const speech: SynthesizeFunction = async (text: string, voiceType: string, {speed, lang}) => {
	const ssml = text.startsWith('<') ? text : `<speak>${textToSsml(text)}</speak>`;

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
