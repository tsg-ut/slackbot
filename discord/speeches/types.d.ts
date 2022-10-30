import {v1beta1} from '@google-cloud/text-to-speech';

export type SynthesizeFunction = (
	text: string,
	voiceType: string,
	meta: {speed: number, emotion?: Emotion, emolv?: EmoLV, lang?: string, engine?: string},
) => Promise<{data: Buffer, timepoints?: v1beta1.ITimepoint[]}>;
