import AWS from 'aws-sdk';
import {SynthesizeFunction} from './types.d';
import {textToSsml} from './util';

new AWS.Config({
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	region: 'ap-northeast-1',
});

const polly = new AWS.Polly({
	region: 'ap-northeast-1',
});

const speech: SynthesizeFunction = async (text: string, voiceType: string, {speed, engine}: {speed: number, engine: string}) => {
	const result = await polly.synthesizeSpeech({
		OutputFormat: 'mp3',
		Text: `
			<speak>
				<prosody rate="${Math.floor(speed * 100)}%">
					${textToSsml(text)}
				</prosody>
			</speak>
		`,
		LanguageCode: 'ja-JP',
		TextType: 'ssml',
		VoiceId: voiceType,
		Engine: engine,
	}).promise();
	return {data: result.AudioStream as Buffer};
};

export default speech;
