import logger from '../../lib/logger';
import amazon from './amazon';
import azure from './azure';
import google from './google';

enum Voice {A = 'A', B = 'B', C = 'C', D = 'D', E = 'E', F = 'F', G = 'G', H = 'H', I = 'I', J = 'J', K = 'K'}
export {Voice};

interface Config {
	provider: 'google' | 'amazon' | 'azure',
	name: string,
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
])

export const getSpeech = (text: string, speed: number, voiceType: Voice) => {
	const config = speechConfig.get(voiceType);
	if (!config) {
		logger.error(`AssertionError: Voice config not found for ${voiceType}`);
		return google(text, speed, 'ja-JP-Wavenet-A');
	}

	if (config.provider === 'google') {
		return google(text, speed, config.name);
	}
	if (config.provider === 'azure') {
		return azure(text, speed, config.name);
	}
	return amazon(text, speed, config.name);
};
