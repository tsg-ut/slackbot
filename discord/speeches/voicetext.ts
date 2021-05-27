import {SynthesizeFunction} from './types.d';
import axios from 'axios';
import querystring from 'querystring';

const speech: SynthesizeFunction = (text: string, speed: number, voiceType: string) => {
    const postData = querystring.stringify({
        text,
        speaker: voiceType,
        speed: Math.floor(speed * 100),
        pitch: 100,
        volume: 100,
        format: 'mp3',
        // for other options, see https://cloud.voicetext.jp/webapi/docs/api
    });
    return new Promise((resolve, reject) => {
        axios.post('https://api.voicetext.jp/v1/tts', postData, {
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

export default speech;