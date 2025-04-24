import openai from '../../lib/openai';
import {SynthesizeFunction} from './types.d';

type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

const speech: SynthesizeFunction = async (text: string, voiceType: VoiceType, options, audioTags) => {
	const mp3 = await openai.audio.speech.create({
		model: options.engine ?? 'tts-1',
		voice: voiceType,
		input: text,
		instructions: 'You are a native Japanese speaker. If the given text is entirely in kanji and you are not sure whether it is Japanese or Chinese, read it in Japanese.\nTone: Emotionless, flat, calm like an announcer',
	});

	return {
		data: Buffer.from(await mp3.arrayBuffer()),
	};
};

export default speech;
