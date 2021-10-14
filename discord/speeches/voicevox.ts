import axios, {AxiosError} from 'axios';
import logger from '../../lib/logger';
import {SynthesizeFunction} from './types.d';
import {Emotion} from './voicetext';

enum VoiceType {
	metan = 0,
	zundamon = 1,
}

const speech: SynthesizeFunction = (text: string, voiceType: string, {speed, emotion}) => {
	if (text.length >= 30) {
		return new Promise((_, reject) => {
			reject(new Error('Text must be shorter than 30 characters for VOICEVOX.'));
		});
	}
	const voiceMapping: { [name: string]: { [emo: string]: number } } = {
		metan: {
			normal: 0,
			happiness: 2,
			anger: 4,
			sadness: 6,
		},
		zundamon: {
			normal: 1,
			happiness: 3,
			anger: 5,
			sadness: 7,
		},
	};
	const postData = {
		text,
		speaker: voiceMapping[voiceType][emotion],
		speed: 1.0 + (speed - 1.0) / 2,
	};
	return new Promise((resolve, reject) => {
		axios.post(process.env.VOICEVOX_API_URL, postData, {
			headers: {
				'content-type': 'application/json',
			},
			responseType: 'arraybuffer',
		}).then((response) => {
			resolve({data: response.data});
		}).catch((reason: AxiosError) => {
			logger.error(`The VoiceVox API server has returned an error: ${reason.response?.data?.toString()}`);
			reject(reason);
		});
	});
};

export default speech;
