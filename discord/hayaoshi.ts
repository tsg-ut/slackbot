import EventEmitter from 'events';
import {promises as fs, createReadStream} from 'fs';
import path from 'path';
import type {AudioPlayer, AudioResource, PlayerSubscription, VoiceConnection} from '@discordjs/voice';
import {createAudioResource, createAudioPlayer, AudioPlayerStatus} from '@discordjs/voice';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import concat from 'concat-stream';
import Discord from 'discord.js';
import {last, max, random, sample, sum, zip} from 'lodash';
import {opus} from 'prism-media';
import {WaveFile} from 'wavefile';
import {increment, unlock} from '../achievements';
import type {Quiz} from '../hayaoshi';
import logger from '../lib/logger';
import {getSpeech, Voice} from './speeches';

const log = logger.child({bot: 'discord'});
const mutex = new Mutex();

const easyChords = [
	['', [0, 4, 7], ''],
	['m', [0, 3, 7], 'マイナー'],
	['dim', [0, 3, 6], 'ディミニッシュド'],
	['aug', [0, 4, 8], 'オーギュメント'],
] as [string, number[], string][];

const normalChords = [
	['7', [0, 4, 7, 10], 'セブンス'],
	['m7', [0, 3, 7, 10], 'マイナーセブンス'],
	['maj7', [0, 4, 7, 11], 'メジャーセブンス'],
	['dim7', [0, 3, 6, 9], 'ディミニッシュドセブンス'],
	['m7-5', [0, 3, 6, 10], 'マイナーセブンスフラットファイブ'],
	['sus2', [0, 2, 7], 'サスツー'],
	['sus4', [0, 5, 7], 'サスフォー'],
	['6', [0, 4, 7, 9], 'シックス'],
	['m6', [0, 3, 7, 9], 'マイナーシックス'],
	['9', [0, 4, 7, 10, 14], 'ナインス'],
	['m9', [0, 3, 7, 10, 14], 'マイナーナインス'],
	['maj9', [0, 4, 7, 11, 14], 'メジャーナインス'],
	['add9', [0, 4, 7, 14], 'アドナインス'],
] as [string, number[], string][];

const allChords = [...easyChords, ...normalChords];

interface State {
	count: number,
	phase: 'waiting' | 'gaming' | 'answering' | 'timeup',
	connection: VoiceConnection,
	audioResource: AudioResource,
	audioPlayer: AudioPlayer,
	subscription: PlayerSubscription,
	quiz: Quiz & {pitches: number[], reading: string},
	pusher: string,
	penaltyUsers: Set<string>,
	timeupTimeoutId: NodeJS.Timeout,
	answerTimeoutId: NodeJS.Timeout,
	playStartTime: number,
	maximumPushTime: number,
	clauses: string[],
	timePoints: number[],
	isContestMode: boolean,
	quizThroughCount: number,
	participants: Map<string, {points: number, penalties: number}>,
	questionCount: number,
	validAnswers: string[],
	isOneChance: boolean,
	isSingleNoteMode: boolean,
	difficulty: 'easy' | 'normal' | 'hard',
}

export default class Hayaoshi extends EventEmitter {
	state: State;

	users: {discord: string, slack: string}[];

	joinVoiceChannelFn: (channelId?: string) => VoiceConnection;

	constructor(joinVoiceChannelFn: (channelId?: string) => VoiceConnection, users: {discord: string, slack: string}[]) {
		super();
		this.joinVoiceChannelFn = joinVoiceChannelFn;
		this.users = users;
		this.state = {
			count: 0,
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
			isContestMode: false,
			quizThroughCount: 0,
			participants: new Map(),
			questionCount: 0,
			validAnswers: [],
			isOneChance: false,
			isSingleNoteMode: false,
			difficulty: 'normal',
		};
		this.onFinishReadingQuestion = this.onFinishReadingQuestion.bind(this);
	}

	getSlashedText() {
		return this.state.quiz.question;
	}

	incrementPoint(user: string, value = 1) {
		if (!this.state.participants.has(user)) {
			this.state.participants.set(user, {points: 0, penalties: 0});
		}
		this.state.participants.get(user).points += value;
	}

	incrementPenalty(user: string) {
		if (!this.state.participants.has(user)) {
			this.state.participants.set(user, {points: 0, penalties: 0});
		}
		const penalties = ++this.state.participants.get(user).penalties;

		if (penalties === 3) {
			const userData = this.users.find(({discord}) => discord === user);
			if (userData) {
				increment(userData.slack, 'discord-hayaoshi-disqualification');
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

	endQuiz({correct = false} = {}) {
		const {penaltyUsers} = this.state;

		const {quiz} = this.state;

		this.state.quiz = null;
		this.state.pusher = null;
		this.state.penaltyUsers = new Set();
		this.state.phase = 'gaming';

		if (quiz && quiz.author) {
			const user = this.users.find(({discord}) => discord === quiz.author);
			if (user) {
				increment(user.slack, 'discord-hayaoshi-my-quiz-is-used');
			}
		}

		if (this.state.isContestMode) {
			if (
				correct &&
				quiz &&
				quiz.author &&
				(
					!this.state.participants.has(quiz.author) ||
					this.state.participants.get(quiz.author).points < 4
				)
			) {
				this.incrementPoint(quiz.author, 0.5);
			}

			const lines = Array.from(this.state.participants.entries()).map(([userId, participant]) => {
				const penaltyText = participant.penalties >= 3 ? '❌' : '';
				const warningText = this.users.some(({discord}) => discord === userId) ? '' : ' (⚠️Slack連携未設定)';
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
		this.emit('message', stripIndent`
			🙁🙁🙁引き分け🙁🙁🙁
		`);
	}

	win(user: string) {
		this.emit('message', stripIndent`
			🎉🎉🎉優勝🎉🎉🎉
			<@${user}>
		`);

		const userData = this.users.find(({discord}) => discord === user);
		if (userData) {
			increment(userData.slack, 'discord-hayaoshi-win');
			if (this.state.participants.get(user)?.points >= 5) {
				increment(userData.slack, 'discord-hayaoshi-complete-win');
				if (this.state.participants.get(user)?.penalties === 0) {
					increment(userData.slack, 'discord-hayaoshi-perfect-win');
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

		this.emit('message', stripIndent`
			正解者: なし
			${this.state.quiz.author ? `作問者: <@${this.state.quiz.author}>` : ''}
			Q. ${this.state.quiz.question}
			A. **${this.state.quiz.answer}**
			有効回答一覧: ${this.state.validAnswers.join(' / ')}
		`);
		if (this.state.penaltyUsers.size === 0) {
			this.state.quizThroughCount++;
		} else {
			this.state.quizThroughCount = 0;
		}
	}

	async onFinishReadingQuestion() {
		log.info('[hayaoshi] onFinishReadingQuestion');
		if (this.state.count < 2) {
			this.state.count++;
			this.readQuestion();
			return;
		}
		await new Promise((resolve) => {
			this.state.timeupTimeoutId = setTimeout(resolve, 5000);
		});
		log.info('[hayaoshi] onFinishReadingQuestion - timeout');
		mutex.runExclusive(async () => {
			if (this.state.phase !== 'gaming') {
				return;
			}
			this.state.phase = 'timeup';
			await this.playSound('timeup');
			await this.readAnswer();
			this.endQuiz({correct: true});
		});
	}

	readQuestion() {
		log.info('[hayaoshi] readQuestion');
		this.state.audioPlayer.off(AudioPlayerStatus.Idle, this.onFinishReadingQuestion);

		this.state.audioResource = createAudioResource(path.join(__dirname, 'questionText.wav'));
		this.state.audioPlayer.play(this.state.audioResource);
		this.state.playStartTime = Date.now();
		this.state.audioResource.playStream.on('start', () => {
			this.state.playStartTime = Date.now();
		});
		log.info('[hayaoshi] readQuestion - started');
		this.state.audioPlayer.once(AudioPlayerStatus.Idle, this.onFinishReadingQuestion);
	}

	getTTS(text: string) {
		return getSpeech(text, Voice.AJ, {speed: 0.9});
	}

	async speak(text: string) {
		if (!this.state.connection) {
			return;
		}

		const audio = await this.getTTS(text);

		await fs.writeFile(path.join(__dirname, 'tempAudio.mp3'), audio.data);

		await this.playSound('../tempAudio');
	}

	setAnswerTimeout() {
		return setTimeout(() => {
			mutex.runExclusive(async () => {
				await this.playSound('timeup');
				this.state.penaltyUsers.add(this.state.pusher);
				this.incrementPenalty(this.state.pusher);
				this.state.pusher = null;
				if (this.state.isContestMode) {
					this.state.phase = 'timeup';
					await this.readAnswer();
					this.endQuiz({correct: false});
				} else {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					this.state.phase = 'gaming';
					this.readQuestion();
				}
			});
		}, this.state.isContestMode ? 20000 : 10000);
	}

	pitchToNoteAndOctave(pitch: number) {
		const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
		const note = notes[pitch % 12];
		const octave = Math.floor(pitch / 12);
		return [note, octave] as [string, number];
	}

	pitchToJapaneseName(pitch: number) {
		const notes = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];
		return notes[pitch % 12];
	}

	setEquals<T>(a: Set<T>, b: Set<T>) {
		return a.size === b.size && [...a].every((value) => b.has(value));
	}

	pitchesToChords(pitches: number[]) {
		const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
		const baseNote = pitches[0] % 12;
		const noteSet = new Set(pitches.map((pitch) => pitch % 12));
		const chords = [];

		for (const rotation of Array(12).keys()) {
			for (const chordCandidate of allChords) {
				const [chordName, chordPitches, chordReading] = chordCandidate;
				const rotatedChordPitches = chordPitches.map((chordPitch) => (chordPitch + rotation) % 12);
				const chordNoteSet = new Set(rotatedChordPitches);

				if (this.setEquals(noteSet, chordNoteSet)) {
					if (rotation === baseNote) {
						chords.push([`${noteNames[rotation]}${chordName}`, `${noteNames[rotation]}${chordReading}`]);
					} else {
						chords.push([`${noteNames[rotation]}${chordName}/${noteNames[baseNote]}`, `${noteNames[rotation]}${chordReading}オン${noteNames[baseNote]}`]);
					}
				}
			}
		}

		return chords;
	}

	pitchToOldJapaneseNames(pitch: number) {
		const notes = [
			['嬰ロ', 'ハ', '重変ニ'],
			['重嬰ロ', '嬰ハ', '変ニ'],
			['重嬰ハ', 'ニ', '重変ホ'],
			['嬰ニ', '変ホ', '重変ヘ'],
			['重嬰ニ', 'ホ', '変ヘ'],
			['嬰ホ', 'ヘ', '重変ト'],
			['重嬰ホ', '嬰ヘ', '変ト'],
			['重嬰ヘ', 'ト', '重変イ'],
			['嬰ヘ', '変イ'],
			['重嬰ト', 'イ', '重変ロ'],
			['嬰イ', '変ロ', '重変ハ'],
			['重嬰イ', 'ロ', '変ハ'],
		];
		return notes[pitch % 12];
	}

	getQuiz() {
		if (this.state.isSingleNoteMode) {
			const basePitch = random(12, 72);
			const [baseNote, baseOctave] = this.pitchToNoteAndOctave(basePitch);
			const answer = `${baseNote}${baseOctave}`;
			const japaneseName = this.pitchToJapaneseName(basePitch);
			const oldJapaneseNames = this.pitchToOldJapaneseNames(basePitch);

			return {
				id: 1,
				question: answer,
				answer: [baseNote, japaneseName, ...oldJapaneseNames].join(' / '),
				pitches: [basePitch],
				reading: baseNote.toString(),
			};
		}

		const chordCandidates = [] as [string, number[], string][];

		if (this.state.difficulty === 'easy') {
			chordCandidates.push(...easyChords);
		} else {
			chordCandidates.push(...easyChords, ...normalChords);
		}

		const basePitch = random(28, 58);
		const [baseNote, baseChord, reading] = sample(chordCandidates);
		const [baseNoteName] = this.pitchToNoteAndOctave(basePitch);

		const pitches = baseChord.map((interval) => basePitch + interval);

		if (this.state.difficulty !== 'easy' && Math.random() < 0.3) {
			const targetPitchIndex = random(1, pitches.length - 1);
			const targetPitch = pitches[targetPitchIndex];

			if (targetPitch + 12 <= 72) {
				pitches[targetPitchIndex] += 12;
			}
		}

		// Rotate pitches randomly

		let rootNote: string | null = null;

		if (this.state.difficulty === 'hard' && last(baseChord) < 12) {
			const rotateCount = random(0, pitches.length - 1);
			const originalRootNote = this.pitchToNoteAndOctave(pitches[0])[0];
			for (const _ of Array(rotateCount).keys()) {
				if (pitches[0] + 12 <= 72) {
					pitches.push(pitches.shift() + 12);
				}
			}

			const newRootNote = this.pitchToNoteAndOctave(pitches[0])[0];
			if (originalRootNote !== newRootNote) {
				rootNote = newRootNote;
			}

			console.log({rotateCount});
		}

		const chordReading = rootNote === null ? `${baseNoteName}${reading}` : `${baseNoteName}${reading}オン${rootNote}`;
		const answer = rootNote === null ? baseNoteName + baseNote : `${baseNoteName}${baseNote}/${rootNote}`;

		console.log({pitches, basePitch, baseNote, baseChord, answer, reading, chordReading});

		pitches.sort((a, b) => a - b);

		return {
			id: 1,
			question: pitches.map((pitch) => this.pitchToNoteAndOctave(pitch).join('')).join(' / '),
			answer,
			reading: chordReading,
			pitches,
		};
	}

	playSound(name: string) {
		this.state.audioPlayer.off(AudioPlayerStatus.Idle, this.onFinishReadingQuestion);

		return new Promise<void>((resolve) => {
			this.state.audioResource = createAudioResource(path.join(__dirname, `sounds/${name}.mp3`));
			this.state.audioPlayer.play(this.state.audioResource);
			this.state.audioPlayer.once(AudioPlayerStatus.Idle, () => {
				resolve();
			});
		});
	}

	async startQuiz(channelId?: string) {
		this.state.maximumPushTime = 0;
		this.state.count = 0;
		this.state.questionCount++;
		this.state.quiz = await this.getQuiz();

		if (this.state.isSingleNoteMode) {
			this.state.validAnswers = this.state.quiz.answer.split(' / ');
		} else {
			const validChords = this.pitchesToChords(this.state.quiz.pitches);
			console.log({validChords});

			this.state.validAnswers = validChords.map(([chordName]) => chordName);
		}

		const pitches = this.state.quiz.question.split(' / ');

		const noteFiles = await Promise.all(pitches.map((pitchName) => (
			new Promise<Buffer>((resolve) => {
				createReadStream(path.join(__dirname, `sounds/notes/${pitchName}.ogg`))
					.pipe(new opus.OggDemuxer())
					.pipe(new opus.Decoder({rate: 48000, channels: 1, frameSize: 960}))
					.pipe(concat(resolve));
			})
		)));

		const noteData = noteFiles.map((noteFile) => new Int16Array(noteFile.buffer));

		const isArpeggioMode = this.state.difficulty === 'easy';

		if (isArpeggioMode) {
			for (const i of noteData.keys()) {
				noteData[i] = new Int16Array([...Array(8000 * i).fill(0), ...noteData[i]]);
			}
		}

		const outputData = zip(...noteData).map((samples) => (
			sum(samples) * 3
		));

		const outputWave = new WaveFile();
		outputWave.fromScratch(1, 44100, '16', outputData);

		await fs.writeFile(path.join(__dirname, 'questionText.wav'), outputWave.toBuffer());

		const answerAudio = await this.getTTS(`<speak>答えは、${this.state.quiz.reading}、でした。</speak>`);

		this.state.clauses = [];
		this.state.timePoints = [];

		// await fs.writeFile(path.join(__dirname, 'questionText.mp3'), questionAudio.data);
		await fs.writeFile(path.join(__dirname, 'answerText.mp3'), answerAudio.data);

		this.state.connection = channelId ? this.joinVoiceChannelFn(channelId) : this.joinVoiceChannelFn();
		this.state.audioPlayer = createAudioPlayer();
		this.state.subscription = this.state.connection.subscribe(this.state.audioPlayer);

		await new Promise((resolve) => setTimeout(resolve, 3000));
		if (this.state.isContestMode) {
			await this.speak(`第${this.state.questionCount}問`);
		} else {
			await this.playSound('mondai');
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
		this.readQuestion();
	}

	judgeAnswer(answer: string) {
		return this.state.validAnswers.includes(answer) ? 'correct' : 'wrong';
	}

	onMessage(message: Discord.Message) {
		if (message.channel.id !== process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID || message.member.user.bot) {
			return;
		}

		mutex.runExclusive(async () => {
			if (this.state.phase === 'answering' && this.state.pusher === message.member.user.id && message.content !== 'p') {
				clearTimeout(this.state.answerTimeoutId);
				const judgement = this.judgeAnswer(message.content.trim());
				if (judgement === 'correct') {
					this.playSound('correct');
					this.incrementPoint(message.member.user.id);

					const user = this.users.find(({discord}) => discord === message.member.user.id);
					if (user) {
						increment(user.slack, 'discord-hayaoshi-correct');
						if (this.state.maximumPushTime <= 2000) {
							unlock(user.slack, 'discord-hayaoshi-time-lt2');
						}
					}

					this.emit('message', stripIndent`
						正解者: <@${message.member.user.id}>
						解答時間: ${(this.state.maximumPushTime / 1000).toFixed(2)}秒 / ${(max(this.state.timePoints) / 1000).toFixed(2)}秒
						${this.state.quiz.author ? `作問者: <@${this.state.quiz.author}>` : ''}
						Q. ${this.getSlashedText()}
						A. **${this.state.quiz.answer}**
						有効回答一覧: ${this.state.validAnswers.join(' / ')}
					`);

					await new Promise((resolve) => setTimeout(resolve, 3000));

					this.state.quizThroughCount = 0;
					this.endQuiz({correct: true});
				} else {
					await this.playSound('wrong');
					this.state.penaltyUsers.add(this.state.pusher);
					this.incrementPenalty(this.state.pusher);
					this.state.pusher = null;
					if (this.state.isContestMode) {
						this.state.phase = 'timeup';
						await this.readAnswer();
						this.endQuiz({correct: false});
					} else {
						await new Promise((resolve) => setTimeout(resolve, 1000));
						this.state.phase = 'gaming';
						this.readQuestion();
					}
				}
			}

			if (
				message.content === 'p' &&
				this.state.phase === 'gaming' &&
				this.state.connection &&
				!this.state.penaltyUsers.has(message.member.user.id) &&
				!(
					this.state.participants.has(message.member.user.id) &&
					this.state.participants.get(message.member.user.id).penalties >= 3
				) &&
				!(
					this.state.quiz.author &&
					this.state.quiz.author === message.member.user.id
				)
			) {
				const now = Date.now();
				const pushTime = now - this.state.playStartTime;
				this.state.maximumPushTime = Math.max(pushTime, this.state.maximumPushTime);
				clearTimeout(this.state.timeupTimeoutId);
				this.state.audioResource.playStream.pause();
				this.playSound('buzzer');
				this.state.pusher = message.member.user.id;
				this.state.phase = 'answering';
				this.state.isOneChance = false;
				await message.react('🚨');
				this.state.answerTimeoutId = this.setAnswerTimeout();
			}

			const contentMatchRegex = /^(?<isChord>コード|単音)当てクイズ(?<isContest>大会)?(?<difficulty>easy|normal|hard)?$/u;
			let matches: RegExpMatchArray | null = null;

			if (
				(matches = contentMatchRegex.exec(message.content)) &&
				this.state.phase === 'waiting'
			) {
				try {
					this.state.phase = 'gaming';
					this.state.playStartTime = 0;
					this.state.maximumPushTime = 0;
					this.state.quizThroughCount = 0;
					this.state.participants = new Map();
					this.state.isContestMode = matches?.groups?.isContest === '大会';
					this.state.isSingleNoteMode = matches?.groups?.isChord === '単音';
					this.state.difficulty = matches?.groups?.difficulty as 'easy' | 'normal' | 'hard' ?? 'normal';
					this.state.questionCount = 0;

					this.emit('start-game');

					if (this.state.isContestMode) {
						this.emit('message', stripIndent`
							【${message.content}】

							ルール
							* 一番最初に5問正解した人が優勝。ただし3問誤答したら失格。(5○3×)
							* 誰かが誤答した場合、その問題は終了。(シングルチャンス)
							* TSGerが作問した問題が出題された場合、作問者は解答権を持たない。
							* 作問者の得点が4点未満、かつその問題が正答またはスルーの場合、作問者は問題終了後に0.5点を得る。
							* 失格者が出たとき、失格していない参加者がいない場合、引き分けで終了。
							* 失格者が出たとき、失格していない参加者が1人の場合、その人が優勝。
							* 正解者も誤答者も出ない問題が5問連続で出題された場合、引き分けで終了。
							* Slackで \`@discord [discordのユーザーID]\` と送信するとSlackアカウントを連携できます。
							* https://tsg-quiz.hkt.sh を編集すると自分で作問した問題を追加できます。
						`);
					}

					await this.startQuiz(message?.member?.voice?.channelId);
				} catch (error) {
					console.log(error);
					console.log(error.stack);

					this.emit('message', `エラー😢\n${error.toString()}`);
					this.emit('message', `Q. ${this.state.quiz.question}\nA. **${this.state.quiz.answer}**`);
					this.endQuiz({correct: true});
				}
			}
		});
	}
}
