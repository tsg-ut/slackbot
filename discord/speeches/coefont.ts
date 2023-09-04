import axios from 'axios';
import {SynthesizeFunction} from './types';

const authorization = 'Bearer **********';
let prevId: string = null;

const speech: SynthesizeFunction = async (text: string, voiceType: string, {speed, engine}: {speed: number, engine: string}) => {
	console.log('start', text);
	const res = await axios.post('https://plbwpbyme3.execute-api.ap-northeast-1.amazonaws.com/production/projects/3d03e5ea-4596-43ce-a2c9-35450496d901/parts/e1106b18-03f0-4859-9cf5-e1cdc92a23ca/blocks', JSON.stringify({
		coefontId: '19d55439-312d-4a1d-a27b-28f0f31bedc5',
		text,
		...(prevId ? {prevId} : {}),
	}), {
		headers: {
			authorization,
			'content-type': 'application/json',
		},
	});
	console.log(res.data);
	const {blockId} = res.data;
	prevId = blockId;
	const res2 = await axios.get(`https://plbwpbyme3.execute-api.ap-northeast-1.amazonaws.com/production/projects/3d03e5ea-4596-43ce-a2c9-35450496d901/parts/e1106b18-03f0-4859-9cf5-e1cdc92a23ca/blocks/${blockId}/audio`, {
		headers: {
			authorization,
		},
	});
	console.log(res2.data);
	const {location} = res2.data;
	const res3 = await axios.get(location, {
		responseType: 'arraybuffer',
	});
	console.log(res3.data);
	return {data: res3.data as Buffer};
};

export default speech;
