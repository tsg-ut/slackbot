import EventEmitter from 'events';
import {promises as fs} from 'fs';
import path from 'path';
import {v1beta1 as GoogleCloudTextToSpeech} from '@google-cloud/text-to-speech';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import Discord, {VoiceConnection} from 'discord.js';
import {minBy, countBy} from 'lodash';
import logger from '../lib/logger';

const {TextToSpeechClient} = GoogleCloudTextToSpeech;

const client = new TextToSpeechClient();
const mutex = new Mutex();

enum Voice {A = 'A', B = 'B', C = 'C', D= 'D'}

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
			return false;
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
	users: Map<string, Voice>;

	userTimers: Map<string, Timer>;

	connection: VoiceConnection;

	isPaused: boolean;

	lastActiveVoiceChannel: string;

	joinVoiceChannelFn: (channelId?: string) => Promise<Discord.VoiceConnection>;

	ttsDictionary: {key: string, value: string}[];

	constructor(joinVoiceChannelFn: () => Promise<Discord.VoiceConnection>, ttsDictionary: {key: string, value: string}[]) {
		super();
		this.joinVoiceChannelFn = joinVoiceChannelFn;
		this.users = new Map();
		this.userTimers = new Map();
		this.connection = null;
		this.isPaused = false;
		this.lastActiveVoiceChannel = null;
		this.ttsDictionary = ttsDictionary;
	}

	async onUsersModified() {
		if (this.isPaused) {
			return;
		}
		if (this.connection === null) {
			if (this.lastActiveVoiceChannel === null) {
				this.connection = await this.joinVoiceChannelFn();
			} else {
				this.connection = await this.joinVoiceChannelFn(this.lastActiveVoiceChannel);
			}
		} else {
			if (this.users.size === 0) {
				this.connection.disconnect();
				this.connection = null;
			}
		}
	}

	assignNewVoice() {
		const voices: Voice[] = Object.values(Voice);
		const users = countBy(Array.from(this.users.values()));
		const voice = minBy(voices, (voice) => users[voice] || 0);
		return voice;
	}

	pause() {
		logger.info('[TTS] pause');
		this.connection = null;
		this.isPaused = true;
	}

	unpause() {
		logger.info('[TTS] unpause');
		mutex.runExclusive(async () => {
			logger.info(`[TTS] unpause - joining channel with lastActiveVoiceChannel ${this.lastActiveVoiceChannel}`);
			await new Promise((resolve) => setTimeout(resolve, 200));
			if (this.users.size !== 0) {
				if (this.lastActiveVoiceChannel === null) {
					this.connection = await this.joinVoiceChannelFn();
				} else {
					this.connection = await this.joinVoiceChannelFn(this.lastActiveVoiceChannel);
				}
			}
			logger.info('[TTS] unpause - connected');
			this.isPaused = false;
		});
	}

	onMessage(message: Discord.Message) {
		if (message.member.user.bot) {
			return;
		}

		mutex.runExclusive(async () => {
			const tokens = message.content.split(/\s+/);
			const user = message.member.user.id;

			if (tokens[0]?.toUpperCase() === 'DTTS') {
				if (tokens.length === 1 || tokens[1] === 'start') {
					if (!this.users.has(user)) {
						this.users.set(user, this.assignNewVoice());
						const timer = new Timer(() => {
							mutex.runExclusive(async () => {
								this.users.delete(user);
								this.userTimers.get(user)?.cancel();
								this.emit('message', stripIndent`
									10分以上発言がなかったので<@${user}>のTTSを解除しました
								`);
								await this.onUsersModified();
							});
						}, 10 * 60 * 1000);
						this.userTimers.set(user, timer);
						if (message.member.voice?.channelID) {
							this.lastActiveVoiceChannel = message.member.voice.channelID;
						}
						await this.onUsersModified();
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				} else if (tokens[1] === 'stop') {
					if (this.users.has(user)) {
						this.users.delete(user);
						this.userTimers.get(user)?.cancel();
						await this.onUsersModified();
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				} else if (tokens.length === 3 && tokens[1] === 'voice') {
					const voice: Voice = Voice[tokens[2] as keyof typeof Voice] || Voice.A;
					if (this.users.has(user)) {
						this.users.set(user, voice);
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				} else if (tokens[1] === 'status') {
					this.emit(
						'message',
						Array.from(this.users.entries())
							.map(([user, voice]) => `* <@${user}> - ${voice}`)
							.join('\n'),
						message.channel.id,
					);
				} else {
					this.emit('message', stripIndent`
						* TTS [start] - TTSを開始 (\`-\`で始まるメッセージは読み上げられません)
						* TTS stop - TTSを停止
						* TTS voice <A | B | C | D> - 声を変更
						* TTS status - ステータスを表示
						* TTS help - ヘルプを表示
					`, message.channel.id);
				}
			} else if (this.users.has(user) && !message.content.startsWith('-') && !this.isPaused) {
				const id = this.users.get(user);
				this.userTimers.get(user)?.resetTimer();
				let content = message.content;
				for (const {key, value} of this.ttsDictionary) {
					content = content.replace(new RegExp(key, 'g'), value);
				}

				const [response] = await client.synthesizeSpeech({
					input: {
						ssml: content,
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
						const dispatcher = this.connection.play(path.join(__dirname, 'tempAudio.mp3'));
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


