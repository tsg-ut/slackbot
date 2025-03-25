import openai from '../../lib/openai';
import {SynthesizeFunction} from './types.d';

type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

const speech: SynthesizeFunction = async (text: string, voiceType: VoiceType, options, audioTags) => {
	const mp3 = await openai.audio.speech.create({
		model: options.engine ?? 'tts-1',
		voice: voiceType,
		input: text,
	});

	return {
		data: Buffer.from(await mp3.arrayBuffer()),
	};
};

export default speech;
