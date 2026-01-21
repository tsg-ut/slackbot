"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const voice_1 = require("@discordjs/voice");
const ytdl_core_1 = __importDefault(require("@distube/ytdl-core"));
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const lodash_1 = require("lodash");
const prism_media_1 = require("prism-media");
const achievements_1 = require("../achievements");
const hayaoshi_1 = require("../hayaoshi");
const logger_1 = __importDefault(require("../lib/logger"));
const utils_1 = require("../lib/utils");
const hayaoshiUtils_1 = require("./hayaoshiUtils");
const speeches_1 = require("./speeches");
const log = logger_1.default.child({ bot: 'discord' });
const createFFmpegStream = (path, seekms) => {
    let seekPosition = '0';
    if (seekms) {
        seekPosition = String(seekms);
    }
    const s16le = new prism_media_1.FFmpeg({
        args: ['-i', path, '-analyzeduration', '0', '-loglevel', '0', '-f', 's16le', '-ar', '48000', '-ac', '2', '-ss', `${seekPosition}ms`],
    });
    const ret = s16le.pipe(new prism_media_1.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 }));
    return ret;
};
class Hayaoshi extends events_1.default {
    state;
    users;
    songHistory;
    introQuizPlaylistsLoader = new utils_1.Loader(() => (0, hayaoshiUtils_1.fetchIntroQuizData)());
    joinVoiceChannelFn;
    mutex = new async_mutex_1.Mutex();
    constructor(joinVoiceChannelFn, users, songHistory) {
        super();
        this.joinVoiceChannelFn = joinVoiceChannelFn;
        this.users = users;
        this.songHistory = songHistory;
        this.state = {
            phase: 'waiting',
            connection: null,
            audioResource: null,
            audioPlayer: null,
            subscription: null,
            quiz: null,
            pusher: null,
            penaltyUsers: new Set(),
            timeupTimeoutId: null,
            answerTimeoutId: null,
            playStartTime: 0,
            maximumPushTime: 0,
            clauses: [],
            timePoints: [],
            quizMode: 'quiz',
            playlist: null,
            isContestMode: false,
            quizThroughCount: 0,
            participants: new Map(),
            questionCount: 0,
            validAnswers: [],
            isOneChance: false,
            resumeSeekms: null,
        };
        this.onFinishReadingQuestion = this.onFinishReadingQuestion.bind(this);
    }
    getSlashedText() {
        if (this.state.quizMode === 'intro-quiz') {
            return this.state.quiz.question;
        }
        return this.state.clauses.map((token, index) => {
            const beforeTime = index === 0 ? 0 : this.state.timePoints[index - 1];
            const afterTime = this.state.timePoints[index];
            if (beforeTime <= this.state.maximumPushTime && this.state.maximumPushTime < afterTime) {
                const chars = Array.from(token);
                const tokenDuration = afterTime - beforeTime;
                const slashIndex = Math.floor((this.state.maximumPushTime - beforeTime) / tokenDuration * chars.length + 0.5);
                return `${chars.slice(0, slashIndex).join('')}/${chars.slice(slashIndex).join('')}`;
            }
            return token;
        }).join('');
    }
    incrementPoint(user, value = 1) {
        if (!this.state.participants.has(user)) {
            this.state.participants.set(user, { points: 0, penalties: 0 });
        }
        this.state.participants.get(user).points += value;
    }
    incrementPenalty(user) {
        if (!this.state.participants.has(user)) {
            this.state.participants.set(user, { points: 0, penalties: 0 });
        }
        const penalties = ++this.state.participants.get(user).penalties;
        if (penalties === 3) {
            const userData = this.users.find(({ discord }) => discord === user);
            if (userData) {
                if (this.state.quizMode === 'quiz') {
                    (0, achievements_1.increment)(userData.slack, 'discord-hayaoshi-disqualification');
                }
                else if (this.state.quizMode === 'intro-quiz') {
                    (0, achievements_1.increment)(userData.slack, 'discord-intro-quiz-disqualification');
                }
            }
        }
    }
    endGame() {
        const oldConnection = this.state.connection;
        this.state.phase = 'waiting';
        this.state.connection = null;
        this.state.quizThroughCount = 0;
        if (oldConnection) {
            oldConnection.destroy();
        }
        this.emit('end-game');
    }
    endQuiz({ correct = false } = {}) {
        const { penaltyUsers } = this.state;
        const { quiz } = this.state;
        this.state.quiz = null;
        this.state.pusher = null;
        this.state.penaltyUsers = new Set();
        this.state.phase = 'gaming';
        this.state.resumeSeekms = null;
        if (quiz && quiz.author) {
            const user = this.users.find(({ discord }) => discord === quiz.author);
            if (user) {
                (0, achievements_1.increment)(user.slack, 'discord-hayaoshi-my-quiz-is-used');
            }
        }
        if (this.state.isContestMode) {
            if (correct &&
                quiz &&
                quiz.author &&
                (!this.state.participants.has(quiz.author) ||
                    this.state.participants.get(quiz.author).points < 4)) {
                this.incrementPoint(quiz.author, 0.5);
            }
            const lines = Array.from(this.state.participants.entries()).map(([userId, participant]) => {
                const penaltyText = participant.penalties >= 3 ? '❌' : '';
                const warningText = this.users.some(({ discord }) => discord === userId) ? '' : ' (⚠️Slack連携未設定)';
                return `<@${userId}>${penaltyText}: ${participant.points}○${participant.penalties}× ${warningText}`;
            });
            this.emit('message', lines.join('\n'));
            if (this.state.quizThroughCount >= 5) {
                this.draw();
                this.endGame();
                return;
            }
            let isPenaltied = false;
            for (const user of penaltyUsers) {
                if (this.state.participants.get(user).penalties >= 3) {
                    isPenaltied = true;
                }
            }
            const liveUsers = [];
            for (const [userId, participant] of this.state.participants.entries()) {
                if (participant.penalties < 3) {
                    liveUsers.push(userId);
                }
            }
            if (isPenaltied) {
                if (liveUsers.length === 0) {
                    this.draw();
                    this.endGame();
                    return;
                }
                if (liveUsers.length === 1) {
                    this.win(liveUsers[0]);
                    this.endGame();
                    return;
                }
            }
            for (const [userId, participant] of this.state.participants.entries()) {
                if (participant.points >= 5) {
                    this.win(userId);
                    this.endGame();
                    return;
                }
            }
            this.startQuiz();
            return;
        }
        this.endGame();
    }
    draw() {
        this.emit('message', (0, common_tags_1.stripIndent) `
			🙁🙁🙁引き分け🙁🙁🙁
		`);
    }
    win(user) {
        this.emit('message', (0, common_tags_1.stripIndent) `
			🎉🎉🎉優勝🎉🎉🎉
			<@${user}>
		`);
        const userData = this.users.find(({ discord }) => discord === user);
        if (userData) {
            if (this.state.quizMode === 'quiz') {
                (0, achievements_1.increment)(userData.slack, 'discord-hayaoshi-win');
                if (this.state.participants.get(user)?.points >= 5) {
                    (0, achievements_1.increment)(userData.slack, 'discord-hayaoshi-complete-win');
                    if (this.state.participants.get(user)?.penalties === 0) {
                        (0, achievements_1.increment)(userData.slack, 'discord-hayaoshi-perfect-win');
                    }
                }
            }
            else if (this.state.quizMode === 'intro-quiz') {
                (0, achievements_1.increment)(userData.slack, 'discord-intro-quiz-win');
                if (this.state.participants.get(user)?.points >= 5) {
                    (0, achievements_1.increment)(userData.slack, 'discord-intro-quiz-complete-win');
                    if (this.state.participants.get(user)?.penalties === 0) {
                        (0, achievements_1.increment)(userData.slack, 'discord-intro-quiz-perfect-win');
                    }
                }
            }
        }
    }
    destroy() {
        if (this.state.subscription) {
            this.state.subscription.unsubscribe();
        }
        if (this.state.connection) {
            this.state.connection.destroy();
        }
    }
    async readAnswer() {
        await this.playSound('../answerText');
        this.emit('message', (0, common_tags_1.stripIndent) `
			正解者: なし
			${this.state.quiz.author ? `作問者: <@${this.state.quiz.author}>` : ''}
			Q. ${this.state.quiz.question}
			A. **${this.state.quiz.answer}**
			有効回答一覧: ${this.state.validAnswers.join(' / ')}
		`);
        if (this.state.penaltyUsers.size === 0) {
            this.state.quizThroughCount++;
        }
        else {
            this.state.quizThroughCount = 0;
        }
    }
    downloadYoutubeAudio(url, begin, fileStream) {
        log.info('[hayaoshi] downloadYoutubeAudio');
        return new Promise((resolve, reject) => {
            const audioStream = (0, ytdl_core_1.default)(url, {
                quality: 'highestaudio',
                begin,
            });
            audioStream.pipe(fileStream);
            let videoInfo = null;
            audioStream.on('info', (info) => {
                videoInfo = info;
            });
            audioStream.on('progress', (chunkLength, downloaded, total) => {
                if (videoInfo?.videoDetails?.lengthSeconds) {
                    const seconds = parseInt(videoInfo.videoDetails.lengthSeconds);
                    if (downloaded / total > 90 / seconds) {
                        audioStream.destroy();
                        log.info('[hayaoshi] downloadYoutubeAudio - finished');
                        resolve();
                    }
                }
            });
            audioStream.on('error', (error) => {
                fileStream.destroy();
                reject(error);
            });
            audioStream.on('end', () => {
                log.info('[hayaoshi] downloadYoutubeAudio - end');
                resolve();
            });
        });
    }
    downloadYoutubeAudioWithTimeout(url, begin, file) {
        const timeout = 5000;
        const fileStream = (0, fs_1.createWriteStream)(file);
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                fileStream.destroy();
                reject(new Error('Timeout'));
            }, timeout);
            this.downloadYoutubeAudio(url, begin, fileStream).then(() => {
                clearTimeout(timeoutId);
                resolve();
            }).catch(reject);
        });
    }
    async downloadYoutubeAudioWithRetries(url, begin, file, retries = 5) {
        try {
            await this.downloadYoutubeAudioWithTimeout(url, begin, file);
        }
        catch (error) {
            if (retries > 0) {
                await this.downloadYoutubeAudioWithRetries(url, begin, file, retries - 1);
            }
            else {
                throw error;
            }
        }
    }
    async onFinishReadingQuestion() {
        log.info('[hayaoshi] onFinishReadingQuestion');
        await new Promise((resolve) => {
            this.state.timeupTimeoutId = setTimeout(resolve, 5000);
        });
        log.info('[hayaoshi] onFinishReadingQuestion - timeout');
        this.mutex.runExclusive(async () => {
            if (this.state.phase !== 'gaming') {
                return;
            }
            this.state.phase = 'timeup';
            await this.playSound('timeup');
            await this.readAnswer();
            this.endQuiz({ correct: true });
        });
    }
    readQuestion() {
        log.info('[hayaoshi] readQuestion');
        this.state.audioPlayer.off(voice_1.AudioPlayerStatus.Idle, this.onFinishReadingQuestion);
        const audiopath = path_1.default.join(__dirname, this.state.quizMode === 'quiz' ? 'questionText.mp3' : 'questionText.webm');
        this.state.audioResource = (0, voice_1.createAudioResource)(this.state.resumeSeekms
            ? createFFmpegStream(audiopath, this.state.resumeSeekms)
            : audiopath, { inlineVolume: this.state.quizMode === 'intro-quiz' });
        if (this.state.quizMode === 'intro-quiz') {
            this.state.audioResource.volume.setVolume(0.15);
        }
        this.state.audioPlayer.play(this.state.audioResource);
        this.state.playStartTime = Date.now();
        this.state.audioResource.playStream.on('start', () => {
            this.state.playStartTime = Date.now();
        });
        log.info('[hayaoshi] readQuestion - started');
        this.state.audioPlayer.once(voice_1.AudioPlayerStatus.Idle, this.onFinishReadingQuestion);
    }
    getTTS(text) {
        return (0, speeches_1.getSpeech)(text, speeches_1.Voice.AJ, { speed: 0.9 });
    }
    async speak(text) {
        if (!this.state.connection) {
            return;
        }
        const audio = await this.getTTS(text);
        await fs_1.promises.writeFile(path_1.default.join(__dirname, 'tempAudio.mp3'), audio.data);
        await this.playSound('../tempAudio');
    }
    getAnswerTimeout() {
        if (this.state.isContestMode) {
            return 20000;
        }
        if (this.state.quizMode === 'intro-quiz') {
            return 15000;
        }
        return 10000;
    }
    setAnswerTimeout() {
        return setTimeout(() => {
            this.mutex.runExclusive(async () => {
                await this.playSound('timeup');
                this.state.penaltyUsers.add(this.state.pusher);
                this.incrementPenalty(this.state.pusher);
                this.state.pusher = null;
                if (this.state.isContestMode) {
                    this.state.phase = 'timeup';
                    await this.readAnswer();
                    this.endQuiz({ correct: false });
                }
                else {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    this.state.phase = 'gaming';
                    this.readQuestion();
                }
            });
        }, this.getAnswerTimeout());
    }
    selectSong(songs) {
        const recentUrls = new Set(this.songHistory.urls);
        const availableSongs = songs.filter((song) => !recentUrls.has(song.url));
        let selectedSong = null;
        if (availableSongs.length === 0) {
            selectedSong = (0, lodash_1.sample)(songs);
        }
        else {
            selectedSong = (0, lodash_1.sample)(availableSongs);
        }
        if (!selectedSong) {
            throw new Error('No songs found');
        }
        this.songHistory.urls = this.songHistory.urls.concat(selectedSong.url).slice(-50);
        return selectedSong;
    }
    async getQuiz() {
        if (this.state.quizMode === 'quiz') {
            const seed = Math.random();
            if (seed < 0.1) {
                return (0, hayaoshi_1.getItQuiz)();
            }
            if (seed < 0.2) {
                return (0, hayaoshi_1.getAbc2019Quiz)();
            }
            if (seed < 0.3) {
                return (0, hayaoshi_1.getUserQuiz)();
            }
            return (0, hayaoshi_1.getHardQuiz)();
        }
        if (this.state.quizMode === 'intro-quiz') {
            let song = null;
            const { playlists, songPools } = await this.introQuizPlaylistsLoader.load();
            const playlistName = `$${this.state.playlist ?? 'default'}`;
            const playlist = playlists.find((playlist) => playlist.name === playlistName);
            if (playlist) {
                song = this.selectSong(playlist.songs);
            }
            else {
                const songPool = songPools.find((pool) => pool.name === this.state.playlist);
                if (songPool) {
                    song = this.selectSong(songPool.songs);
                }
                else {
                    throw new Error(`Playlist not found: ${playlistName}`);
                }
            }
            if (!song) {
                throw new Error('No songs found in the playlist');
            }
            return {
                id: 0, // dummy
                question: song.url,
                answer: song.title,
                song,
            };
        }
        throw new Error('Invalid quiz mode');
    }
    playSound(name) {
        this.state.audioPlayer.off(voice_1.AudioPlayerStatus.Idle, this.onFinishReadingQuestion);
        return new Promise((resolve) => {
            this.state.audioResource = (0, voice_1.createAudioResource)(path_1.default.join(__dirname, `sounds/${name}.mp3`));
            this.state.audioPlayer.play(this.state.audioResource);
            this.state.audioPlayer.once(voice_1.AudioPlayerStatus.Idle, () => {
                resolve();
            });
        });
    }
    async startQuiz() {
        this.state.maximumPushTime = 0;
        this.state.questionCount++;
        this.state.quiz = await this.getQuiz();
        this.state.validAnswers = this.state.quizMode === 'intro-quiz'
            ? [this.state.quiz.answer, this.state.quiz.song?.titleRuby]
            : (0, hayaoshiUtils_1.extractValidAnswers)(this.state.quiz.question, this.state.quiz.answer, this.state.quiz.note);
        if (this.state.quizMode === 'intro-quiz') {
            try {
                await this.downloadYoutubeAudioWithRetries(this.state.quiz.question, `${this.state.quiz.song?.introSeconds ?? 0}s`, path_1.default.join(__dirname, 'questionText.webm'));
            }
            catch (error) {
                log.error(`[hayaoshi] downloadYoutubeAudio error: ${error.toString()}`);
                this.emit('message', `エラー😢\n${error.toString()}`);
                this.emit('message', `Q. ${this.state?.quiz?.question}\nA. **${this.state?.quiz?.answer}**`);
                this.endQuiz({ correct: true });
                return;
            }
        }
        else {
            const { ssml, clauses } = await (0, hayaoshiUtils_1.formatQuizToSsml)(this.state.quiz.question);
            const questionAudio = await this.getTTS(ssml);
            this.state.clauses = clauses;
            this.state.timePoints = questionAudio.timepoints.map((point) => point.timeSeconds * 1000);
            await fs_1.promises.writeFile(path_1.default.join(__dirname, 'questionText.mp3'), questionAudio.data);
        }
        const answerAudio = await this.getTTS(`<speak>答えは、${(0, lodash_1.get)(this.state.validAnswers, 0, '')}、でした。</speak>`);
        await fs_1.promises.writeFile(path_1.default.join(__dirname, 'answerText.mp3'), answerAudio.data);
        this.state.connection = this.joinVoiceChannelFn();
        this.state.audioPlayer = (0, voice_1.createAudioPlayer)();
        this.state.subscription = this.state.connection.subscribe(this.state.audioPlayer);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (this.state.isContestMode) {
            await this.speak(`第${this.state.questionCount}問`);
        }
        else {
            await this.playSound('mondai');
        }
        if (this.state.quizMode === 'quiz') {
            await this.playSound('question');
        }
        this.readQuestion();
    }
    parseQuizStartMessage(text) {
        const components = text.split(/\s+/);
        if (components.length > 2 || components.length === 0) {
            return null;
        }
        const [command, parameter] = components;
        const isContestMode = command.endsWith('大会');
        const messageText = isContestMode ? command.slice(0, -2) : command;
        if (messageText === '早押しクイズ') {
            return {
                quizMode: 'quiz',
                isContestMode,
            };
        }
        if (messageText === 'イントロクイズ') {
            return {
                quizMode: 'intro-quiz',
                isContestMode,
                ...(parameter ? { playlist: parameter } : {}),
            };
        }
        return null;
    }
    onMessage(message) {
        if (message.channel.id !== process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID || message.member.user.bot) {
            return;
        }
        log.info(`[hayaoshi] onMessage: ${message.content}`);
        this.mutex.runExclusive(async () => {
            if (this.state.phase === 'answering' && this.state.pusher === message.member.user.id && message.content !== 'p') {
                log.info(`[hayaoshi] onMessage - answering: ${message.content}`);
                clearTimeout(this.state.answerTimeoutId);
                const judgement = await (0, hayaoshiUtils_1.judgeAnswer)(this.state.validAnswers, message.content);
                if (judgement === 'correct') {
                    this.playSound('correct');
                    this.incrementPoint(message.member.user.id);
                    const user = this.users.find(({ discord }) => discord === message.member.user.id);
                    if (user) {
                        if (this.state.quizMode === 'quiz') {
                            (0, achievements_1.increment)(user.slack, 'discord-hayaoshi-correct');
                            if (this.state.maximumPushTime <= 500) {
                                (0, achievements_1.increment)(user.slack, 'discord-hayaoshi-time-lt-500ms');
                            }
                            if (this.state.maximumPushTime <= 1000) {
                                (0, achievements_1.increment)(user.slack, 'discord-hayaoshi-time-lt1');
                            }
                            if (this.state.maximumPushTime <= 2000) {
                                (0, achievements_1.unlock)(user.slack, 'discord-hayaoshi-time-lt2');
                            }
                        }
                        else if (this.state.quizMode === 'intro-quiz') {
                            (0, achievements_1.increment)(user.slack, 'discord-intro-quiz-correct');
                            if (this.state.maximumPushTime <= 150) {
                                (0, achievements_1.increment)(user.slack, 'discord-intro-quiz-time-lt-150ms');
                            }
                            if (this.state.maximumPushTime <= 300) {
                                (0, achievements_1.increment)(user.slack, 'discord-intro-quiz-time-lt-300ms');
                            }
                            if (this.state.maximumPushTime <= 500) {
                                (0, achievements_1.increment)(user.slack, 'discord-intro-quiz-time-lt-500ms');
                            }
                            if (this.state.maximumPushTime <= 1000) {
                                (0, achievements_1.increment)(user.slack, 'discord-intro-quiz-time-lt1');
                            }
                            if (this.state.maximumPushTime <= 2000) {
                                (0, achievements_1.increment)(user.slack, 'discord-intro-quiz-time-lt2');
                            }
                        }
                    }
                    const denominatorText = this.state.quizMode === 'intro-quiz' ? '' : ` / ${((0, lodash_1.max)(this.state.timePoints) / 1000).toFixed(2)}秒`;
                    this.emit('message', (0, common_tags_1.stripIndent) `
						正解者: <@${message.member.user.id}>
						解答時間: ${(this.state.maximumPushTime / 1000).toFixed(2)}秒${denominatorText}
						${this.state.quiz.author ? `作問者: <@${this.state.quiz.author}>` : ''}
						Q. ${this.getSlashedText()}
						A. **${this.state.quiz.answer}**
						有効回答一覧: ${this.state.validAnswers.join(' / ')}
					`);
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                    this.state.quizThroughCount = 0;
                    this.endQuiz({ correct: true });
                }
                else if (!this.state.isOneChance && judgement === 'onechance') {
                    clearTimeout(this.state.answerTimeoutId);
                    this.state.isOneChance = true;
                    await this.playSound('timeup');
                    await this.speak('もう一度お願いします。');
                    this.state.answerTimeoutId = this.setAnswerTimeout();
                }
                else {
                    await this.playSound('wrong');
                    this.state.penaltyUsers.add(this.state.pusher);
                    this.incrementPenalty(this.state.pusher);
                    this.state.pusher = null;
                    if (this.state.isContestMode) {
                        this.state.phase = 'timeup';
                        await this.readAnswer();
                        this.endQuiz({ correct: false });
                    }
                    else {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        this.state.phase = 'gaming';
                        this.readQuestion();
                    }
                }
            }
            if (message.content === 'p' &&
                this.state.phase === 'gaming' &&
                this.state.connection &&
                !this.state.penaltyUsers.has(message.member.user.id) &&
                !(this.state.participants.has(message.member.user.id) &&
                    this.state.participants.get(message.member.user.id).penalties >= 3) &&
                !(this.state.quiz.author &&
                    this.state.quiz.author === message.member.user.id)) {
                log.info('[hayaoshi] onMessage - p');
                const now = Date.now();
                const pushTime = now - this.state.playStartTime;
                this.state.maximumPushTime = Math.max(pushTime, this.state.maximumPushTime);
                clearTimeout(this.state.timeupTimeoutId);
                this.state.audioResource.playStream.pause();
                this.state.resumeSeekms = this.state.audioResource.playbackDuration;
                this.playSound('buzzer');
                this.state.pusher = message.member.user.id;
                this.state.phase = 'answering';
                this.state.isOneChance = false;
                await message.react('🚨');
                this.state.answerTimeoutId = this.setAnswerTimeout();
            }
            if (this.state.phase === 'waiting') {
                log.info('[hayaoshi] onMessage - waiting');
                const parsed = this.parseQuizStartMessage(message.content);
                if (parsed !== null) {
                    log.info(`[hayaoshi] onMessage - start-game: ${JSON.stringify(parsed)}`);
                    if (parsed.quizMode === 'intro-quiz' && parsed.playlist === 'clear-cache') {
                        this.introQuizPlaylistsLoader.clear();
                        this.emit('message', 'キャッシュをクリアしました');
                    }
                    else {
                        try {
                            this.state.phase = 'gaming';
                            this.state.playStartTime = 0;
                            this.state.maximumPushTime = 0;
                            this.state.quizThroughCount = 0;
                            this.state.participants = new Map();
                            this.state.quizMode = parsed.quizMode;
                            this.state.playlist = parsed.playlist ?? null;
                            this.state.isContestMode = parsed.isContestMode;
                            this.state.questionCount = 0;
                            this.emit('start-game');
                            if (this.state.isContestMode) {
                                const contestName = this.state.quizMode === 'quiz' ? '早押しクイズ' : 'イントロクイズ';
                                const sourceUrl = this.state.quizMode === 'quiz' ? 'https://tsg-quiz.hkt.sh' : 'https://intro-quiz.hkt.sh';
                                this.emit('message', [
                                    `【${contestName}大会】`,
                                    '',
                                    'ルール',
                                    '* 一番最初に5問正解した人が優勝。ただし3問誤答したら失格。(5○3×)',
                                    '* 誰かが誤答した場合、その問題は終了。(シングルチャンス)',
                                    ...(this.state.quizMode === 'quiz' ? [
                                        '* TSGerが作問した問題が出題された場合、作問者は解答権を持たない。',
                                        '* 作問者の得点が4点未満、かつその問題が正答またはスルーの場合、作問者は問題終了後に0.5点を得る。',
                                    ] : []),
                                    '* 失格者が出たとき、失格していない参加者がいない場合、引き分けで終了。',
                                    '* 失格者が出たとき、失格していない参加者が1人の場合、その人が優勝。',
                                    '* 正解者も誤答者も出ない問題が5問連続で出題された場合、引き分けで終了。',
                                    '* Slackで `@discord [discordのユーザーID]` と送信するとSlackアカウントを連携できます。',
                                    `* ${sourceUrl} を編集すると自分で作問した問題を追加できます。`,
                                ].join('\n'));
                            }
                            await this.startQuiz();
                        }
                        catch (error) {
                            log.error(`[hayaoshi] startQuiz error: ${error.toString()}`);
                            this.emit('message', `エラー😢\n${error.toString()}`);
                            this.emit('message', `Q. ${this.state?.quiz?.question}\nA. **${this.state?.quiz?.answer}**`);
                            this.endQuiz({ correct: true });
                        }
                    }
                }
            }
        });
    }
}
exports.default = Hayaoshi;
