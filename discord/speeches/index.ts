import logger from '../../lib/logger';
import amazon from './amazon';
import azure from './azure';
import google from './google';
import voicetext, {Emotion, EmoLV} from './voicetext';
import voicevox from './voicevox';

enum Voice {A = 'A', B = 'B', C = 'C', D = 'D', E = 'E', F = 'F', G = 'G', H = 'H', I = 'I', J = 'J', K = 'K', L = 'L', M = 'M', N = 'N', O = 'O', P = 'P', Q = 'Q', R = 'R', S = 'S', T = 'T', U = 'U', V = 'V', W = 'W', X = 'X', Y = 'Y', Z = 'Z', AA = 'AA', AB = 'AB', AC = 'AC', AD = 'AD', AE = 'AE'}
export {Voice};

export {Emotion, EmoLV};
export interface VoiceMeta {
	speed: number,
	emotion?: Emotion,
	emolv?: EmoLV,
}
export const getDefaultVoiceMeta: () => VoiceMeta = () => ({
	speed: 1.2,
	emotion: Emotion.normal,
	emolv: 2,
});

interface Config {
	provider: 'google' | 'amazon' | 'azure' | 'voicetext' | 'voicevox',
	name: string,
	emotional?: boolean,
	lang?: string,
}

export const speechConfig: Map<Voice, Config> = new Map([
	[Voice.A, {provider: 'google', name: 'ja-JP-Wavenet-A', lang: 'ja-JP'}],
	[Voice.B, {provider: 'google', name: 'ja-JP-Wavenet-B', lang: 'ja-JP'}],
	[Voice.C, {provider: 'google', name: 'ja-JP-Wavenet-C', lang: 'ja-JP'}],
	[Voice.D, {provider: 'google', name: 'ja-JP-Wavenet-D', lang: 'ja-JP'}],
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
	[Voice.R, {provider: 'google', name: 'en-US-Wavenet-H', lang: 'en-US'}],
	[Voice.S, {provider: 'google', name: 'en-US-Wavenet-I', lang: 'en-US'}],
	[Voice.T, {provider: 'voicevox', name: 'metan', emotional: true}],
	[Voice.U, {provider: 'voicevox', name: 'zundamon', emotional: true}],
	[Voice.V, {provider: 'voicevox', name: 'tsumugi'}],
	[Voice.W, {provider: 'voicevox', name: 'ritsu'}],
	[Voice.X, {provider: 'voicevox', name: 'hau'}],
	[Voice.Y, {provider: 'voicevox', name: 'takehiro'}],
	[Voice.Z, {provider: 'voicevox', name: 'torataro'}],
	[Voice.AA, {provider: 'voicevox', name: 'ryusei'}],
	[Voice.AB, {provider: 'voicevox', name: 'himari'}],
	[Voice.AC, {provider: 'voicevox', name: 'sora', emotional: true}],
	[Voice.AD, {provider: 'voicevox', name: 'sora_whisper'}],
	[Voice.AE, {provider: 'voicevox', name: 'mochiko'}],
]);

export const getSpeech = (text: string, voiceType: Voice, meta: VoiceMeta) => {
	const config = speechConfig.get(voiceType);
	if (!config) {
		logger.error(`AssertionError: Voice config not found for ${voiceType}`);
		return google(text, 'ja-JP-Wavenet-A', meta);
	}

	if (config.provider === 'google') {
		return google(text, config.name, {...meta, lang: config.lang});
	}
	if (config.provider === 'azure') {
		return azure(text, config.name, meta);
	}
	if (config.provider === 'amazon') {
		return amazon(text, config.name, meta);
	}
	if (config.provider === 'voicevox') {
		return voicevox(text, config.name, meta);
	}
	return voicetext(text, config.name, meta);
};
