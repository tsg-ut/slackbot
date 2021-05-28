import {SynthesizeFunction} from './types.d';
import axios from 'axios';
import {URLSearchParams} from 'url';
import logger from '../../lib/logger';

enum Emotion {
    normal = 'normal',
    happiness = 'happiness',
    anger = 'anger',
    sadness = 'sadness',
};
type EmoLV = number;
export {Emotion, EmoLV};

export const speech: SynthesizeFunction = (text: string, speed: number, voiceType: string, emotion?: Emotion, emolv?: EmoLV) => {
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
            validateStatus: (status) => (status === 200),
            responseType: 'arraybuffer',
        }).then((response) => {
            resolve({data: response.data});
        }).catch((reason) => {
            console.log(reason);
            console.log(reason.response.data.error);
            reject(reason);
        });
    });
};