import {SpeechConfig, SpeechSynthesizer} from 'microsoft-cognitiveservices-speech-sdk';
import {SynthesizeFunction} from './types.d';
import {textToSsml} from './util';

const speech: SynthesizeFunction = (text: string, voiceType: string, {speed}: {speed: number}) => {
	const speechConfig = SpeechConfig.fromSubscription(process.env.AZURE_SUBSCRIPTION_KEY, 'japaneast');
	const synthesizer = new SpeechSynthesizer(speechConfig);

	return new Promise((resolve, reject) => {
		synthesizer.speakSsmlAsync(
			`
				<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">
					<voice name="${voiceType}">
						<prosody rate="${speed}">
							${textToSsml(text)}
						</prosody>
					</voice>
				</speak>
			`,
			(result) => {
				const {audioData} = result;

				if (!(audioData instanceof ArrayBuffer)) {
					reject(result);
					return;
				}

				synthesizer.close();
				if (result) {
					resolve({data: Buffer.from(audioData)});
				}
			},
			(error) => {
				reject(error);
				synthesizer.close();
			},
		);
	});
};

export default speech;
