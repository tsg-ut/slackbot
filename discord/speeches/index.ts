import amazon from './amazon';
import azure from './azure';
import google from './google';

export const getSpeech = (text: string, speed: number, voiceType: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K') => {
	if (voiceType === 'A') {
		return google(text, speed, 'ja-JP-Wavenet-A');
	}
	if (voiceType === 'B') {
		return google(text, speed, 'ja-JP-Wavenet-B');
	}
	if (voiceType === 'C') {
		return google(text, speed, 'ja-JP-Wavenet-C');
	}
	if (voiceType === 'D') {
		return google(text, speed, 'ja-JP-Wavenet-D');
	}
	if (voiceType === 'E') {
		return azure(text, speed, 'ja-JP-NanamiNeural');
	}
	if (voiceType === 'F') {
		return azure(text, speed, 'ja-JP-KeitaNeural');
	}
	if (voiceType === 'G') {
		return azure(text, speed, 'ja-JP-Ayumi');
	}
	if (voiceType === 'H') {
		return amazon(text, speed, 'Takumi');
	}
	if (voiceType === 'I') {
		return amazon(text, speed, 'Mizuki');
	}
	if (voiceType === 'J') {
		return azure(text, speed, 'ja-JP-HarukaRUS');
	}
	if (voiceType === 'K') {
		return azure(text, speed, 'ja-JP-Ichiro');
	}
	return azure(text, speed, 'ja-JP-Ichiro');
};
