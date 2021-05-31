import AWS from 'aws-sdk';
import {SynthesizeFunction} from './types.d';

new AWS.Config({
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	region: 'ap-northeast-1',
});

const polly = new AWS.Polly({
	region: 'ap-northeast-1',
});

const speech: SynthesizeFunction = async (text: string, voiceType: string, {speed}: {speed: number}) => {
	const result = await polly.synthesizeSpeech({
		OutputFormat: 'mp3',
		Text: `
			<speak>
				<prosody rate="${Math.floor(speed * 100)}%">
					${text}
				</prosody>
			</speak>
		`,
		LanguageCode: 'ja-JP',
		TextType: 'ssml',
		VoiceId: voiceType,
	}).promise();
	return {data: result.AudioStream as Buffer};
};

export default speech;
