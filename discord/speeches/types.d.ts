import {v1beta1} from '@google-cloud/text-to-speech';

export type SynthesizeFunction = (text: string, speed: number, voiceType: string, emotion?: string, emolv?: number) => Promise<{data: Buffer, timepoints?: v1beta1.ITimepoint[]}>;
