import EventEmitter from 'events';
import {promises as fs} from 'fs';
import path from 'path';
import type {AudioPlayer, AudioResource, PlayerSubscription, VoiceConnection} from '@discordjs/voice';
import {createAudioResource, createAudioPlayer, AudioPlayerStatus} from '@discordjs/voice';

import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import Discord from 'discord.js';
import {max, get} from 'lodash';
import {increment, unlock} from '../achievements';
import {getHardQuiz, getItQuiz, getUserQuiz, Quiz, getAbc2019Quiz} from '../hayaoshi';
import logger from '../lib/logger';
import {extractValidAnswers, judgeAnswer, formatQuizToSsml} from './hayaoshiUtils';
import {getSpeech, Voice} from './speeches';

const mutex = new Mutex();

interface State {
	phase: 'waiting' | 'gaming' | 'answering' | 'timeup',
	connection: VoiceConnection,
	audioResource: AudioResource,
	audioPlayer: AudioPlayer,
	subscription: PlayerSubscription,
	quiz: Quiz,
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
}

export default class Hayaoshi extends EventEmitter {
	state: State;

	users: {discord: string, slack: string}[];

	joinVoiceChannelFn: () => VoiceConnection;

	constructor(joinVoiceChannelFn: () => VoiceConnection, users: {discord: string, slack: string}[]) {
		super();
		this.joinVoiceChannelFn = joinVoiceChannelFn;
		this.users = users;
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
			isContestMode: false,
			quizThroughCount: 0,
			participants: new Map(),
			questionCount: 0,
			validAnswers: [],
			isOneChance: false,
		};
	}

	getSlashedText() {
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

	incrementPoint(user: string, value: number = 1) {
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
		logger.info('[hayaoshi] onFinishReadingQuestion');
		await new Promise((resolve) => {
			this.state.timeupTimeoutId = setTimeout(resolve, 5000);
		});
		logger.info('[hayaoshi] onFinishReadingQuestion - timeout');
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
		logger.info('[hayaoshi] readQuestion');
		this.state.audioPlayer.off(AudioPlayerStatus.Idle, this.onFinishReadingQuestion);

		this.state.audioResource = createAudioResource(path.join(__dirname, 'questionText.mp3'));
		this.state.audioPlayer.play(this.state.audioResource);
		this.state.playStartTime = Date.now();
		this.state.audioResource.playStream.on('start', () => {
			this.state.playStartTime = Date.now();
		});
		logger.info('[hayaoshi] readQuestion - started');
		this.state.audioPlayer.once(AudioPlayerStatus.Idle, this.onFinishReadingQuestion);
	}

	getTTS(text: string) {
		return getSpeech(text, Voice.C, {speed: 0.9});
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

	getQuiz() {
		const seed = Math.random();
		if (seed < 0.1) {
			return getItQuiz();
		}
		if (seed < 0.2) {
			return getAbc2019Quiz();
		}
		if (seed < 0.3) {
			return getUserQuiz();
		}
		return getHardQuiz();
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

	async startQuiz() {
		this.state.maximumPushTime = 0;
		this.state.questionCount++;
		this.state.quiz = await this.getQuiz();
		this.state.validAnswers = extractValidAnswers(this.state.quiz.question, this.state.quiz.answer, this.state.quiz.note);

		const {ssml, clauses} = await formatQuizToSsml(this.state.quiz.question);

		const questionAudio = await this.getTTS(ssml);
		const answerAudio = await this.getTTS(`<speak>答えは、${get(this.state.validAnswers, 0, '')}、でした。</speak>`);

		this.state.clauses = clauses;
		this.state.timePoints = questionAudio.timepoints.map((point) => point.timeSeconds * 1000);

		await fs.writeFile(path.join(__dirname, 'questionText.mp3'), questionAudio.data);
		await fs.writeFile(path.join(__dirname, 'answerText.mp3'), answerAudio.data);

		this.state.connection = this.joinVoiceChannelFn();
		this.state.audioPlayer = createAudioPlayer();
		this.state.subscription = this.state.connection.subscribe(this.state.audioPlayer);

		await new Promise((resolve) => setTimeout(resolve, 3000));
		if (this.state.isContestMode) {
			await this.speak(`第${this.state.questionCount}問`);
		} else {
			await this.playSound('mondai');
		}
		await this.playSound('question');
		this.readQuestion();
	}

	onMessage(message: Discord.Message) {
		if (message.channel.id !== process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID || message.member.user.bot) {
			return;
		}

		mutex.runExclusive(async () => {
			if (this.state.phase === 'answering' && this.state.pusher === message.member.user.id && message.content !== 'p') {
				clearTimeout(this.state.answerTimeoutId);
				const judgement = await judgeAnswer(this.state.validAnswers, message.content);
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
				} else if (!this.state.isOneChance && judgement === 'onechance') {
					clearTimeout(this.state.answerTimeoutId);
					this.state.isOneChance = true;
					await this.playSound('timeup');
					await this.speak('もう一度お願いします。');
					this.state.answerTimeoutId = this.setAnswerTimeout();
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

			if ((message.content === '早押しクイズ' || message.content === '早押しクイズ大会') && this.state.phase === 'waiting') {
				try {
					this.state.phase = 'gaming';
					this.state.playStartTime = 0;
					this.state.maximumPushTime = 0;
					this.state.quizThroughCount = 0;
					this.state.participants = new Map();
					this.state.isContestMode = message.content === '早押しクイズ大会';
					this.state.questionCount = 0;

					this.emit('start-game');

					if (this.state.isContestMode) {
						this.emit('message', stripIndent`
							【早押しクイズ大会】

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

					await this.startQuiz();
				} catch (error) {
					this.emit('message', `エラー😢\n${error.toString()}`);
					this.emit('message', `Q. ${this.state.quiz.question}\nA. **${this.state.quiz.answer}**`);
					this.endQuiz({correct: true});
				}
			}
		});
	}
}
