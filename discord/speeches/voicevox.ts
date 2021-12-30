import axios, {AxiosError} from 'axios';
import logger from '../../lib/logger';
import {SynthesizeFunction} from './types.d';

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
	tsumugi: {
		normal: 8,
		happiness: 8,
		anger: 8,
		sadness: 8,
	},
	ritsu: {
		normal: 9,
		happiness: 9,
		anger: 9,
		sadness: 9,
	},
	hau: {
		normal: 10,
		happiness: 10,
		anger: 10,
		sadness: 10,
	},
};

const speech: SynthesizeFunction = (text: string, voiceType: string, {speed, emotion}) => {
	const postData = {
		text,
		speaker: voiceMapping[voiceType][emotion || 'normal'],
		speed: 1.0 + (speed - 1.0) / 2,
	};
	return new Promise((resolve, reject) => {
		axios.post<Buffer>(process.env.VOICEVOX_API_URL, postData, {
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
