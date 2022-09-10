import EventEmitter from 'events';
import {promises as fs} from 'fs';
import path from 'path';
import {inspect} from 'util';
import {VoiceConnection, AudioPlayer, PlayerSubscription, createAudioResource, createAudioPlayer, AudioPlayerStatus} from '@discordjs/voice';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import Discord from 'discord.js';
import {minBy, countBy} from 'lodash';
import _logger from '../lib/logger';
import State from '../lib/state';
import {Loader, Deferred} from '../lib/utils';
import {getSpeech, Voice, speechConfig, Emotion, VoiceMeta, getDefaultVoiceMeta} from './speeches';

const logger = _logger.child({bot: 'discord'});
const mutex = new Mutex();

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

interface StateObj {
	userVoices: {[id: string]: Voice},
	userMetas: {[id: string]: VoiceMeta},
}


export default class TTS extends EventEmitter {
	users: Set<string>;

	userTimers: Map<string, Timer>;

	connection: VoiceConnection;

	audioPlayer: AudioPlayer;

	subscription: PlayerSubscription;

	isPaused: boolean;

	lastActiveVoiceChannel: string;

	joinVoiceChannelFn: (channelId?: string) => VoiceConnection;

	ttsDictionary: {key: string, value: string}[];

	state: Loader<StateObj>;

	constructor(joinVoiceChannelFn: () => VoiceConnection, ttsDictionary: {key: string, value: string}[]) {
		super();
		this.joinVoiceChannelFn = joinVoiceChannelFn;
		this.users = new Set();
		this.userTimers = new Map();
		this.connection = null;
		this.isPaused = false;
		this.lastActiveVoiceChannel = null;
		this.ttsDictionary = ttsDictionary;
		this.state = new Loader<StateObj>(() => (
			State.init<StateObj>('discord-tts', {
				userVoices: Object.create(null),
				userMetas: Object.create(null),
			})
		));
	}

	onUsersModified() {
		if (this.isPaused) {
			return;
		}
		if (this.connection === null) {
			if (this.lastActiveVoiceChannel === null) {
				this.connection = this.joinVoiceChannelFn();
			} else {
				this.connection = this.joinVoiceChannelFn(this.lastActiveVoiceChannel);
			}
			this.audioPlayer = createAudioPlayer();
			this.subscription = this.connection.subscribe(this.audioPlayer);
		} else {
			if (this.users.size === 0) {
				this.subscription.unsubscribe();
				this.connection.destroy();
				this.connection = null;
			}
		}
	}

	async assignNewVoice() {
		const state = await this.state.load();
		const voices: Voice[] = Object.values(Voice);
		const assignedVoices: Voice[] = Object.values(state.userVoices);
		const voiceCounts = countBy(assignedVoices);
		const voice = minBy(voices, (voice) => voiceCounts[voice] || 0);
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
					this.connection = this.joinVoiceChannelFn();
				} else {
					this.connection = this.joinVoiceChannelFn(this.lastActiveVoiceChannel);
				}
				this.audioPlayer = createAudioPlayer();
				this.subscription = this.connection.subscribe(this.audioPlayer);
			}
			logger.info('[TTS] unpause - connected');
			this.isPaused = false;
		});
	}

	async onMessage(message: Discord.Message) {
		if (message.member.user.bot) {
			return;
		}

		const tokens = message.content.split(/\s+/);
		const user = message.member.user.id;

		if (tokens[0]?.toUpperCase() === 'TTS') {
			if (tokens.length === 1 || tokens[1] === 'start') {
				mutex.runExclusive(async () => {
					if (!this.users.has(user)) {
						const state = await this.state.load();
						if (!{}.hasOwnProperty.call(state.userVoices, user)) {
							const newVoice = await this.assignNewVoice();
							state.userVoices[user] = newVoice;
						}
						if (!{}.hasOwnProperty.call(state.userMetas, user)) {
							state.userMetas[user] = getDefaultVoiceMeta();
						}
						this.users.add(user);
						const timer = new Timer(() => {
							this.users.delete(user);
							this.userTimers.get(user)?.cancel();
							this.emit('message', stripIndent`
								30分以上発言がなかったので<@${user}>のTTSを解除しました
							`);
							this.onUsersModified();
						}, 30 * 60 * 1000);
						this.userTimers.set(user, timer);
						if (message.member.voice?.channelId) {
							this.lastActiveVoiceChannel = message.member.voice.channelId;
						}
						this.onUsersModified();
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				});
			} else if (tokens[1] === 'stop') {
				mutex.runExclusive(async () => {
					if (this.users.has(user)) {
						this.users.delete(user);
						this.userTimers.get(user)?.cancel();
						this.onUsersModified();
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				});
			} else if (tokens.length === 3 && tokens[1] === 'voice') {
				mutex.runExclusive(async () => {
					const voice: Voice = Voice[tokens[2] as keyof typeof Voice] || Voice.A;
					if (this.users.has(user)) {
						const state = await this.state.load();
						state.userVoices[user] = voice;
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				});
			} else if (tokens[1] === 'voices') {
				const voices: Voice[] = Object.values(Voice);
				const voicesText = voices.map((voice) => {
					const config = speechConfig.get(voice);
					let providerName = '';
					if (config.provider === 'google') {
						providerName = 'Google Cloud Text-to-Speech';
					} else if (config.provider === 'azure') {
						providerName = 'Microsoft Azure Text-to-Speech';
					} else if (config.provider === 'amazon') {
						providerName = 'Amazon Polly';
					} else if (config.provider === 'voicetext') {
						providerName = 'VoiceText Web API';
					} else if (config.provider === 'voicevox') {
						providerName = 'VoiceVox Web API';
					} else {
						providerName = 'Unknown';
					}
					return `* \`${voice}\`: **${config.name}** (${providerName})`;
				}).join('\n');
				this.emit('message', voicesText);
			} else if (tokens[1] === 'status') {
				mutex.runExclusive(async () => {
					if (this.users.size === 0) {
						this.emit('message', '誰もTTSを使用してないよ😌');
					} else {
						const state = await this.state.load();
						this.emit(
							'message',
							Array.from(this.users)
								.map((user) => `* <@${user}> - ${state.userVoices[user]} ${state.userMetas[user].emotion}-lv.${state.userMetas[user].emolv}`)
								.join('\n'),
							message.channel.id,
						);
					}
				});
			} else if (tokens.length === 3 && tokens[1] === 'emotion') {
				mutex.runExclusive(async () => {
					const emotion: Emotion = Emotion[tokens[2] as keyof typeof Emotion] || Emotion.normal;
					if (this.users.has(user)) {
						const state = await this.state.load();
						state.userMetas[user].emotion = emotion;
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				});
			} else if (tokens.length === 3 && tokens[1] === 'emolv') {
				mutex.runExclusive(async () => {
					let level: number = parseInt(tokens[2]);
					if (isNaN(level) || level < 1 || level > 4) {
						level = 2;
					}
					if (this.users.has(user)) {
						const state = await this.state.load();
						state.userMetas[user].emolv = level;
						await message.react('🆗');
					} else {
						await message.react('🤔');
					}
				});
			} else {
				const voices: Voice[] = Object.values(Voice);
				const emotionalVoices: Voice[] = voices.filter((v: Voice) => (speechConfig.get(v).emotional));
				this.emit('message', stripIndent`
					* TTS [start] - TTSを開始 (\`-\`で始まるメッセージは読み上げられません)
					* TTS stop - TTSを停止
					* TTS voice <${voices.join(' | ')}> - ボイスを変更
					* TTS voices - 利用可能なボイスの一覧を表示
					* TTS status - ステータスを表示
					* TTS emotion <normal | happiness | anger | sadness> - 感情を付与 (ボイス${emotionalVoices.join('/')}のみ可能)
					* TTS emolv <1 | 2 | 3 | 4> - 感情の強度を設定 (ボイス${emotionalVoices.join('/')}のみ可能)
					* TTS help - ヘルプを表示
				`, message.channel.id);
			}
		} else if (this.users.has(user) && !message.content.startsWith('-') && !this.isPaused) {
			const {content, id, meta} = await mutex.runExclusive(async () => {
				const state = await this.state.load();
				const id = state.userVoices[user] || Voice.A;
				const meta = state.userMetas[user] || getDefaultVoiceMeta();
				this.userTimers.get(user)?.resetTimer();
				let {content} = message;
				for (const {key, value} of this.ttsDictionary) {
					content = content.replace(new RegExp(key, 'g'), value);
				}
				return {content, id, meta};
			});
			try {
				const speech = await getSpeech(content, id, meta);
				await mutex.runExclusive(async () => {
					if (!this.connection) {
						return; // 再生時にTTSBotがログアウトしていたら諦める
					}

					await fs.writeFile(path.join(__dirname, 'tempAudio.mp3'), speech.data);
					const resource = createAudioResource(path.join(__dirname, 'tempAudio.mp3'));

					const playDeferred = new Deferred<void>();
					const onFinishPlaying = () => {
						playDeferred.resolve();
					};
					this.audioPlayer.once(AudioPlayerStatus.Idle, onFinishPlaying);
					this.audioPlayer.play(resource);
					await Promise.race([
						playDeferred.promise,
						new Promise<void>((resolve) => {
							setTimeout(() => {
								this.audioPlayer.off(AudioPlayerStatus.Idle, onFinishPlaying);
								resolve();
							}, 10 * 1000);
						}),
					]);
				});
			} catch (error) {
				this.emit('message', `エラー😢: ${error.stack ? error.stack : inspect(error, {depth: null, colors: false})}`);
			}
		}
	}
}
