import openai from '../../lib/openai.js';
import type {SynthesizeFunction} from './types.js';

type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

const speech: SynthesizeFunction = async (text: string, voiceType: string, options, audioTags) => {
	const mp3 = await openai.audio.speech.create({
		model: options.engine ?? 'tts-1',
		voice: voiceType as VoiceType,
		input: text,
		instructions: 'You are a native Japanese speaker. If the given text is entirely in kanji and you are not sure whether it is Japanese or Chinese, read it in Japanese.\nTone: Emotionless, flat, calm like an announcer',
	});

	return {
		data: Buffer.from(mp3.data),
	};
};

export default speech;
