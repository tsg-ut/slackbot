import logger from '../../lib/logger';
import axios, {AxiosError} from 'axios';
import {SynthesizeFunction, Emotion} from './types.d';

interface IErrorResponse {
	error: {
		message: string,
	},
}

const speech: SynthesizeFunction = (text: string, voiceType: string, {speed, emotion, emolv}) => {
	const postData = new URLSearchParams({
		text,
		speaker: voiceType,
		speed: Math.floor(speed * 100).toString(),
		pitch: '100',
		volume: '100',
		format: 'mp3',
		// for other options, see https://cloud.voicetext.jp/webapi/docs/api
	});
	if (emotion && emolv && emotion !== Emotion.normal) {
		postData.set('emotion', emotion);
		postData.set('emotion_level', emolv.toString());
	}
	return new Promise((resolve, reject) => {
		axios.post('https://api.voicetext.jp/v1/tts', postData.toString(), {
			auth: {
				username: process.env.VOICETEXT_API_KEY,
				password: '',
			},
			responseType: 'arraybuffer',
		}).then((response) => {
			resolve({ data: response.data });
		}).catch((reason: AxiosError<IErrorResponse>) => {
			logger.error(`The VoiceText API server has returned an error: ${reason.response.data.error.message}`);
			reject(reason);
		});
	});
};

export default speech;
