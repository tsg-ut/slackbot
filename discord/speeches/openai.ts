import openai from '../../lib/openai';
import {SynthesizeFunction} from './types.d';

type VoiceType = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';

const speech: SynthesizeFunction = async (text: string, voiceType: string, options, audioTags) => {
	const res = await openai.realtime.speech.create({
		model: options.engine ?? 'gpt-realtime-2.1-mini',
		voice: voiceType as VoiceType,
		input: text,
		instructions: 'You are a native Japanese speaker. If the given text is entirely in kanji and you are not sure whether it is Japanese or Chinese, read it in Japanese.\nTone: Emotionless, flat, calm like an announcer',
	});

	return {
		data: Buffer.from(res.data),
	};
};

export default speech;
