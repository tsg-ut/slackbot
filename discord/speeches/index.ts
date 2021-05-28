import logger from '../../lib/logger';
import amazon from './amazon';
import azure from './azure';
import google from './google';
import {speech as voicetext, Emotion, EmoLV} from './voicetext';

enum Voice {A = 'A', B = 'B', C = 'C', D = 'D', E = 'E', F = 'F', G = 'G', H = 'H', I = 'I', J = 'J', K = 'K', L = 'L', M = 'M', N = 'N', O = 'O', P = 'P', Q = 'Q'}
export {Voice};

export interface VoiceMeta {
	speed: number,
	emotion?: Emotion,
	emolv?: EmoLV,
}
export function getDefaultVoiceMeta(): VoiceMeta {
	return {
		speed: 1.2,
		emotion: Emotion.normal,
		emolv: 2,
	};
}

interface Config {
	provider: 'google' | 'amazon' | 'azure' | 'voicetext',
	name: string,
	emotional?: boolean,
}

export const speechConfig: Map<Voice, Config> = new Map([
	[Voice.A, {provider: 'google', name: 'ja-JP-Wavenet-A'}],
	[Voice.B, {provider: 'google', name: 'ja-JP-Wavenet-B'}],
	[Voice.C, {provider: 'google', name: 'ja-JP-Wavenet-C'}],
	[Voice.D, {provider: 'google', name: 'ja-JP-Wavenet-D'}],
	[Voice.E, {provider: 'amazon', name: 'Mizuki'}],
	[Voice.F, {provider: 'amazon', name: 'Takumi'}],
	[Voice.G, {provider: 'azure', name: 'ja-JP-NanamiNeural'}],
	[Voice.H, {provider: 'azure', name: 'ja-JP-KeitaNeural'}],
	[Voice.I, {provider: 'azure', name: 'ja-JP-Ayumi'}],
	[Voice.J, {provider: 'azure', name: 'ja-JP-HarukaRUS'}],
	[Voice.K, {provider: 'azure', name: 'ja-JP-Ichiro'}],
	[Voice.L, {provider: 'voicetext', name: 'show'}],
	[Voice.M, {provider: 'voicetext', name: 'haruka', emotional: true}],
	[Voice.N, {provider: 'voicetext', name: 'hikari', emotional: true}],
	[Voice.O, {provider: 'voicetext', name: 'takeru', emotional: true}],
	[Voice.P, {provider: 'voicetext', name: 'santa', emotional: true}],
	[Voice.Q, {provider: 'voicetext', name: 'bear', emotional: true}],
])

export const getSpeech = (text: string, voiceType: Voice, meta: VoiceMeta) => {
	const config = speechConfig.get(voiceType);
	if (!config) {
		logger.error(`AssertionError: Voice config not found for ${voiceType}`);
		return google(text, 'ja-JP-Wavenet-A', meta);
	}

	if (config.provider === 'google') {
		return google(text, config.name, meta);
	}
	if (config.provider === 'azure') {
		return azure(text, config.name, meta);
	}
	if (config.provider === 'amazon') {
		return amazon(text, config.name, meta);
	}
	return voicetext(text, config.name, meta);
};
