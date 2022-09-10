import axios from 'axios';
import _logger from '../../lib/logger';
import {SynthesizeFunction} from './types.d';

enum Emotion {
    normal = 'normal',
    happiness = 'happiness',
    anger = 'anger',
    sadness = 'sadness',
}
type EmoLV = number;
export {Emotion, EmoLV};

const logger = _logger.child({bot: 'discord'});

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
	if (emotion && emolv && voiceType !== 'show' && emotion !== Emotion.normal) {
		postData.set('emotion', emotion);
		postData.set('emotion_level', emolv.toString());
	}
	return new Promise((resolve, reject) => {
		axios.post<Buffer>('https://api.voicetext.jp/v1/tts', Buffer.from(postData.toString()), {
			auth: {
				username: process.env.VOICETEXT_API_KEY,
				password: '',
			},
			responseType: 'arraybuffer',
		}).then((response) => {
			resolve({data: response.data});
		}).catch((reason) => {
			if (axios.isAxiosError(reason)) {
				logger.error(`The VoiceText API server has returned an error: ${reason.response?.data}`);
			}
			reject(reason);
		});
	});
};

export default speech;
