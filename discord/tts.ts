import EventEmitter from 'events';
import {promises as fs} from 'fs';
import path from 'path';
import {v1beta1 as GoogleCloudTextToSpeech} from '@google-cloud/text-to-speech';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import Discord, {StreamDispatcher, VoiceConnection} from 'discord.js';
import {tokenize, KuromojiToken} from 'kuromojin';
import {max, get, minBy, countBy} from 'lodash';
import {getHardQuiz, getItQuiz, getHakatashiItQuiz, Quiz} from '../hayaoshi';
import {extractValidAnswers, judgeAnswer} from './hayaoshiUtils';

const {TextToSpeechClient} = GoogleCloudTextToSpeech;

const client = new TextToSpeechClient();
const mutex = new Mutex();

enum Voice {A = 'A', B = 'B', C = 'C', D= 'D'};

interface State {
	users: Map<string, Voice>,
	userTimers: Map<string, Timer>,
	connection: VoiceConnection,
	isPaused: boolean,
}

class Timer {
	time: number;
	timeoutId: NodeJS.Timeout;
	isFired: boolean;
	func: () => void;

	constructor(func: () => void, time: number) {
		this.time = time;
		this.timeoutId = setTimeout(() => {
			this.onCall();
		}, time);
		this.isFired = false;
		this.func = func;
	}

	onCall() {
		this.isFired = true;
		if (typeof this.func === 'function') {
			this.func();
		}
	}

	cancel() {
		if (this.isFired) {
			return false
		}
		clearTimeout(this.timeoutId);
		return true;
	}

	resetTimer() {
		if (this.isFired) {
			return false;
		}
		clearTimeout(this.timeoutId);
		this.timeoutId = setTimeout(() => {
			this.onCall();
		}, this.time);
		return true;
	}
}

export default class TTS extends EventEmitter {
	state: State;

	joinVoiceChannelFn: () => Promise<Discord.VoiceConnection>;

	constructor(joinVoiceChannelFn: () => Promise<Discord.VoiceConnection>) {
		super();
		this.joinVoiceChannelFn = joinVoiceChannelFn;
		this.state = {
			users: new Map(),
			userTimers: new Map(),
			connection: null,
			isPaused: false,
		};
	}

	async onUsersModified() {
		if (this.state.isPaused) {
			return;
		}
		if (this.state.connection === null) {
			this.state.connection = await this.joinVoiceChannelFn();
		} else {
			if (this.state.users.size === 0) {
				this.state.connection.disconnect();
				this.state.connection = null;
			}
		}
	}

	assignNewVoice() {
		const voices: Voice[] = Object.values(Voice);
		const users = countBy(Array.from(this.state.users.values()));
		const voice = minBy(voices, (voice) => users[voice] || 0);
		return voice;
	}

	pause() {
		this.state.connection = null;
	}

	unpause() {
		mutex.runExclusive(async () => {
			if (this.state.users.size !== 0) {
				this.state.connection = await this.joinVoiceChannelFn();
			}
		});
	}

	onMessage(message: Discord.Message) {
		mutex.runExclusive(async () => {
			const tokens = message.content.split(/\s+/);
			const user = message.member.user.id;

			if (tokens[0]?.toUpperCase() === 'TTS') {
				if (tokens.length === 1 || tokens[1] === 'start') {
					if (!this.state.users.has(user)) {
						this.state.users.set(user, this.assignNewVoice());
						const timer = new Timer(() => {
							mutex.runExclusive(async () => {
								this.state.users.delete(user);
								this.state.userTimers.get(user)?.cancel();
								this.emit('message', stripIndent`
									10分以上発言がなかったので<@${user}>のTTSを解除しました
								`)
								await this.onUsersModified();
							});
						}, 10 * 60 * 1000);
						this.state.userTimers.set(user, timer);
						await this.onUsersModified();
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				} else if (tokens[1] === 'stop') {
					if (this.state.users.has(user)) {
						this.state.users.delete(user);
						this.state.userTimers.get(user)?.cancel();
						await this.onUsersModified();
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				} else if (tokens.length === 3 && tokens[1] === 'voice') {
					const voice: Voice = Voice[tokens[2] as keyof typeof Voice] || Voice.A;
					if (this.state.users.has(user)) {
						this.state.users.set(user, voice)
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				} else if (tokens[1] === 'status') {
					this.emit(
						'message',
						Array.from(this.state.users.entries())
							.map(([user, voice]) => `* <@${user}> - ${voice}`)
							.join('\n'),
					);
				} else {
					this.emit('message', stripIndent`
						* TTS [start] - TTSを開始 (\`-\`で始まるメッセージは読み上げられません)
						* TTS stop - TTSを停止
						* TTS voice <A | B | C | D> - 声を変更
						* TTS status - ステータスを表示
						* TTS help - ヘルプを表示
					`);
				}
			} else if (this.state.users.has(user) && !message.content.startsWith('-')) {
				const id = this.state.users.get(user);
				this.state.userTimers.get(user)?.resetTimer();

				const [response] = await client.synthesizeSpeech({
					input: {
						ssml: message.content,
					},
					voice: {
						languageCode: 'ja-JP',
						name: `ja-JP-Wavenet-${id}`,
					},
					audioConfig: {
						audioEncoding: 'MP3',
						speakingRate: 1.2,
						effectsProfileId: ['headphone-class-device'],
					},
					// @ts-ignore
					enableTimePointing: ['SSML_MARK'],
				});
				await fs.writeFile(path.join(__dirname, 'tempAudio.mp3'), response.audioContent, 'binary');
				
				await Promise.race([
					new Promise<void>((resolve) => {
						const dispatcher = this.state.connection.play(path.join(__dirname, 'tempAudio.mp3'));
						dispatcher.on('finish', () => {
							resolve();
						});
					}),
					new Promise<void>((resolve) => {
						setTimeout(resolve, 10 * 1000);
					}),
				]);
			}
		});
	}
}


