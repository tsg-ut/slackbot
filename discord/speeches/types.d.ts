import {v1beta1} from '@google-cloud/text-to-speech';

enum Emotion {
    normal = 'normal',
    happiness = 'happiness',
    anger = 'anger',
    sadness = 'sadness',
}
type EmoLV = number;
export {Emotion, EmoLV};

export type SynthesizeFunction = (
	text: string,
	voiceType: string,
	meta: {speed: number, emotion?: Emotion, emolv?: EmoLV}
) => Promise<{data: Buffer, timepoints?: v1beta1.ITimepoint[]}>;
