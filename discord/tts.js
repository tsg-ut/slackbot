"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const voice_1 = require("@discordjs/voice");
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const lodash_1 = require("lodash");
const logger_1 = __importDefault(require("../lib/logger"));
const state_1 = __importDefault(require("../lib/state"));
const utils_1 = require("../lib/utils");
const speeches_1 = require("./speeches");
const log = logger_1.default.child({ bot: 'discord' });
const mutex = new async_mutex_1.Mutex();
class Timer {
    time;
    timeoutId;
    isFired;
    func;
    constructor(func, time) {
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
class TTS extends events_1.default {
    users;
    userTimers;
    connection;
    audioPlayer;
    subscription;
    isPaused;
    lastActiveVoiceChannel;
    joinVoiceChannelFn;
    ttsDictionary;
    state;
    constructor(joinVoiceChannelFn, ttsDictionary) {
        super();
        this.joinVoiceChannelFn = joinVoiceChannelFn;
        this.users = new Set();
        this.userTimers = new Map();
        this.connection = null;
        this.isPaused = false;
        this.lastActiveVoiceChannel = null;
        this.ttsDictionary = ttsDictionary;
        this.state = new utils_1.Loader(() => (state_1.default.init('discord-tts', {
            userVoices: Object.create(null),
            userMetas: Object.create(null),
            audioTags: Object.create(null),
        })));
    }
    onUsersModified() {
        if (this.isPaused) {
            return;
        }
        if (this.connection === null) {
            if (this.lastActiveVoiceChannel === null) {
                this.connection = this.joinVoiceChannelFn();
            }
            else {
                this.connection = this.joinVoiceChannelFn(this.lastActiveVoiceChannel);
            }
            this.audioPlayer = (0, voice_1.createAudioPlayer)();
            this.subscription = this.connection.subscribe(this.audioPlayer);
        }
        else {
            if (this.users.size === 0) {
                this.subscription.unsubscribe();
                this.connection.destroy();
                this.connection = null;
            }
        }
    }
    destroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
        if (this.connection) {
            this.connection.destroy();
        }
    }
    async assignNewVoice() {
        const state = await this.state.load();
        const voices = Object.values(speeches_1.Voice);
        const assignedVoices = Object.values(state.userVoices);
        const voiceCounts = (0, lodash_1.countBy)(assignedVoices);
        const voice = (0, lodash_1.minBy)(voices, (voice) => voiceCounts[voice] || 0);
        return voice;
    }
    pause() {
        log.info('[TTS] pause');
        this.connection = null;
        this.isPaused = true;
    }
    unpause() {
        log.info('[TTS] unpause');
        mutex.runExclusive(async () => {
            log.info(`[TTS] unpause - joining channel with lastActiveVoiceChannel ${this.lastActiveVoiceChannel}`);
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (this.users.size !== 0) {
                if (this.lastActiveVoiceChannel === null) {
                    this.connection = this.joinVoiceChannelFn();
                }
                else {
                    this.connection = this.joinVoiceChannelFn(this.lastActiveVoiceChannel);
                }
                this.audioPlayer = (0, voice_1.createAudioPlayer)();
                this.subscription = this.connection.subscribe(this.audioPlayer);
            }
            log.info('[TTS] unpause - connected');
            this.isPaused = false;
        });
    }
    async onMessage(message) {
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
                            state.userMetas[user] = (0, speeches_1.getDefaultVoiceMeta)();
                        }
                        this.users.add(user);
                        const timer = new Timer(() => {
                            this.users.delete(user);
                            this.userTimers.get(user)?.cancel();
                            this.emit('message', (0, common_tags_1.stripIndent) `
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
                    }
                    else {
                        await message.react('🤔');
                    }
                });
            }
            else if (tokens[1] === 'stop') {
                mutex.runExclusive(async () => {
                    if (this.users.has(user)) {
                        this.users.delete(user);
                        this.userTimers.get(user)?.cancel();
                        this.onUsersModified();
                        await message.react('🆗');
                    }
                    else {
                        await message.react('🤔');
                    }
                });
            }
            else if (tokens.length === 3 && tokens[1] === 'voice') {
                mutex.runExclusive(async () => {
                    const voice = speeches_1.Voice[tokens[2]] || speeches_1.Voice.A;
                    if (this.users.has(user)) {
                        const state = await this.state.load();
                        state.userVoices[user] = voice;
                        await message.react('🆗');
                    }
                    else {
                        await message.react('🤔');
                    }
                });
            }
            else if (tokens[1] === 'voices') {
                const voices = Object.values(speeches_1.Voice);
                for (const voicesChunk of (0, lodash_1.chunk)(voices, 20)) {
                    const voicesText = voicesChunk.map((voice) => {
                        const config = speeches_1.speechConfig.get(voice);
                        let providerName = '';
                        if (config.provider === 'google') {
                            providerName = 'Google Cloud Text-to-Speech';
                        }
                        else if (config.provider === 'azure') {
                            providerName = 'Microsoft Azure Text-to-Speech';
                        }
                        else if (config.provider === 'amazon') {
                            providerName = 'Amazon Polly';
                        }
                        else if (config.provider === 'voicetext') {
                            providerName = 'VoiceText Web API';
                        }
                        else if (config.provider === 'voicevox') {
                            providerName = 'VoiceVox Web API';
                        }
                        else if (config.provider === 'openai') {
                            providerName = 'OpenAI Text-to-Speech';
                        }
                        else {
                            providerName = 'Unknown';
                        }
                        if (config.model) {
                            providerName += `: ${config.model} model`;
                        }
                        return `* \`${voice}\`: **${config.name}** (${providerName})`;
                    }).join('\n');
                    this.emit('message', voicesText);
                    await new Promise((resolve) => setTimeout(resolve, 200));
                }
            }
            else if (tokens[1] === 'status') {
                mutex.runExclusive(async () => {
                    if (this.users.size === 0) {
                        this.emit('message', '誰もTTSを使用してないよ😌');
                    }
                    else {
                        const state = await this.state.load();
                        this.emit('message', Array.from(this.users)
                            .map((user) => `* <@${user}> - ${state.userVoices[user]} ${state.userMetas[user].emotion}-lv.${state.userMetas[user].emolv}`)
                            .join('\n'), message.channel.id);
                    }
                });
            }
            else if (tokens.length === 3 && tokens[1] === 'emotion') {
                mutex.runExclusive(async () => {
                    const emotion = speeches_1.Emotion[tokens[2]] || speeches_1.Emotion.normal;
                    if (this.users.has(user)) {
                        const state = await this.state.load();
                        state.userMetas[user].emotion = emotion;
                        await message.react('🆗');
                    }
                    else {
                        await message.react('🤔');
                    }
                });
            }
            else if (tokens.length === 3 && tokens[1] === 'emolv') {
                mutex.runExclusive(async () => {
                    let level = parseInt(tokens[2]);
                    if (isNaN(level) || level < 1 || level > 4) {
                        level = 2;
                    }
                    if (this.users.has(user)) {
                        const state = await this.state.load();
                        state.userMetas[user].emolv = level;
                        await message.react('🆗');
                    }
                    else {
                        await message.react('🤔');
                    }
                });
            }
            else if (tokens.length === 5 && tokens[1] === 'audio' && tokens[2] === 'set') {
                mutex.runExclusive(async () => {
                    // eslint-disable-next-line prefer-const
                    let [, , , tag, url] = tokens;
                    if (tag.startsWith('[') && tag.endsWith(']')) {
                        tag = tag.slice(1, -1);
                    }
                    const state = await this.state.load();
                    state.audioTags[tag] = url;
                    await message.react('🆗');
                });
            }
            else if (tokens.length === 4 && tokens[1] === 'audio' && tokens[2] === 'delete') {
                mutex.runExclusive(async () => {
                    let [, , , tag] = tokens;
                    if (tag.startsWith('[') && tag.endsWith(']')) {
                        tag = tag.slice(1, -1);
                    }
                    const state = await this.state.load();
                    delete state.audioTags[tag];
                    await message.react('🆗');
                });
            }
            else if (tokens.length === 3 && tokens[1] === 'audio' && tokens[2] === 'list') {
                mutex.runExclusive(async () => {
                    const state = await this.state.load();
                    const lines = Object.entries(state.audioTags).map(([tag, url]) => (`* \`[${tag}]\`: ${url}`));
                    this.emit('message', lines.join('\n'), message.channel.id);
                });
            }
            else {
                const voices = Object.values(speeches_1.Voice);
                const emotionalVoices = voices.filter((v) => (speeches_1.speechConfig.get(v).emotional));
                this.emit('message', (0, common_tags_1.stripIndent) `
					* TTS [start] - TTSを開始 (\`-\`で始まるメッセージは読み上げられません)
					* TTS stop - TTSを停止
					* TTS voice <${voices.join(' | ')}> - ボイスを変更
					* TTS voices - 利用可能なボイスの一覧を表示
					* TTS status - ステータスを表示
					* TTS emotion <normal | happiness | anger | sadness> - 感情を付与 (ボイス${emotionalVoices.join('/')}のみ可能)
					* TTS emolv <1 | 2 | 3 | 4> - 感情の強度を設定 (ボイス${emotionalVoices.join('/')}のみ可能)
					* TTS audio set <tag> <url> - []で囲って使用できるオーディオタグを設定 (GoogleとAzureのみ対応)
					* TTS audio delete <tag> - オーディオタグを削除
					* TTS audio list - オーディオタグの一覧を表示
					* TTS help - ヘルプを表示
				`, message.channel.id);
            }
        }
        else if (this.users.has(user) && !message.content.startsWith('-') && !this.isPaused) {
            const { content, id, meta, audioTags } = await mutex.runExclusive(async () => {
                const state = await this.state.load();
                const id = state.userVoices[user] || speeches_1.Voice.A;
                const meta = state.userMetas[user] || (0, speeches_1.getDefaultVoiceMeta)();
                this.userTimers.get(user)?.resetTimer();
                let { content } = message;
                for (const { key, value } of this.ttsDictionary) {
                    content = content.replace(new RegExp(key, 'g'), value);
                }
                return { content, id, meta, audioTags: state.audioTags };
            });
            try {
                const speech = await (0, speeches_1.getSpeech)(content, id, meta, audioTags);
                await mutex.runExclusive(async () => {
                    if (!this.connection) {
                        return; // 再生時にTTSBotがログアウトしていたら諦める
                    }
                    await fs_1.promises.writeFile(path_1.default.join(__dirname, 'tempAudio.mp3'), speech.data);
                    const resource = (0, voice_1.createAudioResource)(path_1.default.join(__dirname, 'tempAudio.mp3'));
                    const playDeferred = new utils_1.Deferred();
                    const onFinishPlaying = () => {
                        playDeferred.resolve();
                    };
                    this.audioPlayer.once(voice_1.AudioPlayerStatus.Idle, onFinishPlaying);
                    this.audioPlayer.play(resource);
                    await Promise.race([
                        playDeferred.promise,
                        new Promise((resolve) => {
                            setTimeout(() => {
                                this.audioPlayer.off(voice_1.AudioPlayerStatus.Idle, onFinishPlaying);
                                resolve();
                            }, 10 * 1000);
                        }),
                    ]);
                });
            }
            catch (error) {
                log.error('stack' in error ? error.stack : error);
                this.emit('message', `エラー😢: ${error.message ? error.message : (0, util_1.inspect)(error, { depth: null, colors: false })}`);
            }
        }
    }
}
exports.default = TTS;
