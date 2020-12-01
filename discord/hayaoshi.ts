import EventEmitter from 'events';
import {promises as fs} from 'fs';
import path from 'path';
import {v1beta1 as GoogleCloudTextToSpeech} from '@google-cloud/text-to-speech';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import Discord, {StreamDispatcher, VoiceConnection} from 'discord.js';
import {tokenize, KuromojiToken} from 'kuromojin';
import {max} from 'lodash';
import {getHardQuiz, getItQuiz, Quiz, isCorrectAnswer, normalize} from '../hayaoshi';

const {TextToSpeechClient} = GoogleCloudTextToSpeech;

const client = new TextToSpeechClient();
const mutex = new Mutex();

interface State {
	phase: 'waiting' | 'gaming' | 'answering' | 'timeup',
	dispatcher: StreamDispatcher,
	connection: VoiceConnection,
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
}

export default class Hayaoshi extends EventEmitter {
	state: State;

	joinVoiceChannelFn: () => Promise<Discord.VoiceConnection>;

	constructor(joinVoiceChannelFn: () => Promise<Discord.VoiceConnection>) {
		super();
		this.joinVoiceChannelFn = joinVoiceChannelFn;
		this.state = {
			phase: 'waiting',
			dispatcher: null,
			connection: null,
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

	endGame() {
		if (this.state.connection) {
			this.state.connection.disconnect();
		}

		this.state.phase = 'waiting';
		this.state.connection = null;
		this.state.dispatcher = null;
		this.state.quiz = null;
		this.state.pusher = null;
		this.state.penaltyUsers = new Set();
	}

	readOutText() {
		this.state.dispatcher = this.state.connection.play(path.join(__dirname, 'questionText.mp3'));
		this.state.playStartTime = Date.now();
		this.state.dispatcher.on('start', () => {
			this.state.playStartTime = Date.now();
		});
		this.state.dispatcher.on('finish', async () => {
			await new Promise((resolve) => {
				this.state.timeupTimeoutId = setTimeout(resolve, 5000);
			});
			mutex.runExclusive(async () => {
				if (this.state.phase !== 'gaming') {
					return;
				}
				this.state.phase = 'timeup';
				await new Promise((resolve) => {
					const dispatcher =
				this.state.connection.play(path.join(__dirname, 'sounds/timeup.mp3'));
					dispatcher.on('finish', () => {
						resolve();
					});
				});
				await new Promise((resolve) => {
					const dispatcher =
				this.state.connection.play(path.join(__dirname, 'answerText.mp3'));
					dispatcher.on('finish', () => {
						resolve();
					});
				});

				this.emit('message', `正解者: なし\nQ. ${this.state.quiz.question}\nA. **${this.state.quiz.answer}**`);
				this.endGame();
			});
		});
	}

	async getTTS(text: string) {
		const [response] = await client.synthesizeSpeech({
			input: {
				ssml: text,
			},
			voice: {
				languageCode: 'ja-JP',
				name: 'ja-JP-Wavenet-C',
			},
			audioConfig: {
				audioEncoding: 'MP3',
				speakingRate: 0.9,
				effectsProfileId: ['headphone-class-device'],
			},
			// @ts-ignore
			enableTimePointing: ['SSML_MARK'],
		});
		return response;
	}

	isFuzokugo(token: KuromojiToken) {
		return token.pos === '助詞' || token.pos === '助動詞' || token.pos_detail_1 === '接尾' || token.pos_detail_1 === '非自立';
	}

	onMessage(message: Discord.Message) {
		mutex.runExclusive(async () => {
			if (this.state.phase === 'answering' && this.state.pusher === message.member.user.id && message.content !== 'p') {
				clearTimeout(this.state.answerTimeoutId);
				if (isCorrectAnswer(this.state.quiz.answer, message.content)) {
					this.state.connection.play(path.join(__dirname, 'sounds/correct.mp3'));

					this.emit('message', stripIndent`
						正解者: <@${message.member.user.id}>
						解答時間: ${(this.state.maximumPushTime / 1000).toFixed(2)}秒 / ${(max(this.state.timePoints) / 1000).toFixed(2)}秒
						Q. ${this.getSlashedText()}
						A. **${this.state.quiz.answer}**
					`);

					await new Promise((resolve) => setTimeout(resolve, 3000));
					this.endGame();
				} else {
					this.state.connection.play(path.join(__dirname, 'sounds/wrong.mp3'));
					this.state.penaltyUsers.add(this.state.pusher);
					this.state.pusher = null;
					await new Promise((resolve) => setTimeout(resolve, 1000));
					this.state.phase = 'gaming';
					this.readOutText();
				}
			}

			if (message.content === 'p' && this.state.phase === 'gaming' && this.state.connection && !this.state.penaltyUsers.has(message.member.user.id)) {
				const now = Date.now();
				const pushTime = now - this.state.playStartTime;
				this.state.maximumPushTime = Math.max(pushTime, this.state.maximumPushTime);
				clearTimeout(this.state.timeupTimeoutId);
				this.state.dispatcher.pause();
				this.state.connection.play(path.join(__dirname, 'sounds/buzzer.mp3'));
				this.state.pusher = message.member.user.id;
				this.state.phase = 'answering';
				await message.react('🚨');
				this.state.answerTimeoutId = setTimeout(() => {
					mutex.runExclusive(async () => {
						await new Promise((resolve) => {
							const dispatcher =
				this.state.connection.play(path.join(__dirname, 'sounds/timeup.mp3'));
							dispatcher.on('finish', () => {
								resolve();
							});
						});
						this.state.phase = 'gaming';
						this.state.penaltyUsers.add(this.state.pusher);
						this.state.pusher = null;
						await new Promise((resolve) => setTimeout(resolve, 1000));
						this.readOutText();
					});
				}, 10000);
			}

			if ((message.content === '早押しクイズ' || message.content === '早押しクイズ大会') && this.state.phase === 'waiting') {
				try {
					this.state.phase = 'gaming';
					this.state.playStartTime = 0;
					this.state.maximumPushTime = 0;
					this.state.isContestMode = message.content === '早押しクイズ大会';

					this.state.quiz = await (Math.random() < 0.2 ? getItQuiz() : getHardQuiz());
					const normalizedQuestion = this.state.quiz.question.replace(/\(.+?\)/g, '');

					const tokens = await tokenize(normalizedQuestion);

					const clauses: string[] = [];
					for (const [index, token] of tokens.entries()) {
						let prevPos: string = null;
						if (index !== 0) {
							prevPos = tokens[index - 1].pos;
						}
						if (clauses.length === 0 || token.pos === '記号') {
							clauses.push(token.surface_form);
						} else if (prevPos === '名詞' && token.pos === '名詞') {
							clauses[clauses.length - 1] += token.surface_form;
						} else if (this.isFuzokugo(token)) {
							clauses[clauses.length - 1] += token.surface_form;
						} else {
							clauses.push(token.surface_form);
						}
					}

					const spannedQuestionText = clauses.map((clause, index) => (
						`${clause}<mark name="c${index}"/>`
					)).join('');

					const questionAudio = await this.getTTS(`<speak>${spannedQuestionText}</speak>`);
					const answerAudio = await this.getTTS(`<speak>答えは、${normalize(this.state.quiz.answer)}、でした。</speak>`);

					this.state.clauses = clauses;
					this.state.timePoints = questionAudio.timepoints.map((point) => point.timeSeconds * 1000);

					await fs.writeFile(path.join(__dirname, 'questionText.mp3'), questionAudio.audioContent, 'binary');
					await fs.writeFile(path.join(__dirname, 'answerText.mp3'), answerAudio.audioContent, 'binary');

					this.state.connection = await this.joinVoiceChannelFn();

					await new Promise((resolve) => setTimeout(resolve, 3000));
					await new Promise((resolve) => {
						const dispatcher = this.state.connection.play(path.join(__dirname, 'sounds/mondai.mp3'));
						dispatcher.on('finish', () => {
							resolve();
						});
					});
					await new Promise((resolve) => {
						const dispatcher = this.state.connection.play(path.join(__dirname, 'sounds/question.mp3'));
						dispatcher.on('finish', () => {
							resolve();
						});
					});
					this.readOutText();
				} catch (error) {
					this.emit('message', `エラー😢\n${error.toString()}`);
					this.emit('message', `Q. ${this.state.quiz.question}\nA. **${this.state.quiz.answer}**`);
					this.endGame();
				}
			}
		});
	}
}
