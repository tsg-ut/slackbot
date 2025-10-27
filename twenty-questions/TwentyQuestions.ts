import {randomUUID} from 'crypto';
import type {BlockAction, ViewSubmitAction} from '@slack/bolt';
import type {SlackMessageAdapter} from '@slack/interactive-messages';
import type {WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {sampleSize, sample} from 'lodash';
import logger from '../lib/logger';
import openai from '../lib/openai';
import type {SlackInterface} from '../lib/slack';
import State from '../lib/state';
import db from '../lib/firestore';
import {firestore} from 'firebase-admin';
import {getCandidateWords} from '../lib/candidateWords';
import {increment} from '../achievements';
import gameStatusMessage from './views/gameStatusMessage';
import playerModal from './views/playerModal';
import gameLogModal from './views/gameLogModal';
import {MAX_QUESTIONS, MAX_QUESTION_LENGTH, MAX_ANSWER_LENGTH} from './const';
import type {CollectionReference} from 'firebase-admin/lib/firestore';

const mutex = new Mutex();
const log = logger.child({bot: 'twenty-questions'});

const GAME_TIMEOUT = 30 * 60 * 1000;

export interface Question {
	question: string;
	answer: string;
	timestamp: number;
	isAnswerAttempt?: boolean;
	isCorrect?: boolean;
}

export interface PlayerState {
	userId: string;
	questions: Question[];
	questionCount: number;
	isFinished: boolean;
	score: number | null;
}

export interface GameState {
	id: string;
	topic: string;
	topicRuby: string;
	topicDescription: string;
	status: 'active' | 'finished';
	startedAt: number;
	finishedAt: number | null;
	players: {[userId: string]: PlayerState};
	statusMessageTs: string | null;
}

export interface StateObj {
	currentGame: GameState | null;
}

export interface FinishedGame {
	id: string;
	topic: string;
	topicRuby: string;
	topicDescription: string;
	startedAt: firestore.Timestamp;
	finishedAt: firestore.Timestamp;
	players: {
		userId: string;
		questionCount: number;
		score: number | null;
		questions: Question[];
	}[];
}

const TwentyQuestionsGames = db.collection('twenty_questions_games') as CollectionReference<FinishedGame>;

export class TwentyQuestions {
	#slack: WebClient;

	#interactions: SlackMessageAdapter;

	#state: StateObj;

	#SANDBOX_ID = process.env.CHANNEL_SANDBOX ?? '';

	static async create(slack: SlackInterface) {
		log.info('Creating twenty-questions bot instance');

		const state = await State.init<StateObj>('twenty-questions', {
			currentGame: null,
		});

		return new TwentyQuestions(slack, state);
	}

	constructor(slack: SlackInterface, state: StateObj) {
		this.#slack = slack.webClient;
		this.#interactions = slack.messageClient;
		this.#state = state;

		if (!this.#SANDBOX_ID || this.#SANDBOX_ID === 'CXXXXXXXX') {
			throw new Error('CHANNEL_SANDBOX環境変数が設定されていません');
		}

		this.#interactions.action({
			type: 'button',
			actionId: 'twenty_questions_join_button',
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked the join button`);
			mutex.runExclusive(() => this.handleJoinButton(payload));
		});

		this.#interactions.viewSubmission(
			'twenty_questions_player_modal',
			(payload: ViewSubmitAction) => {
				log.info(`${payload.user.name} submitted player modal`);
				mutex.runExclusive(() => this.handleModalSubmit(payload));
			},
		);

		this.#interactions.action({
			type: 'button',
			actionId: 'twenty_questions_submit_question',
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked submit question button`);
			mutex.runExclusive(() => this.handleQuestionSubmit(payload));
		});

		this.#interactions.action({
			type: 'button',
			actionId: 'twenty_questions_submit_answer',
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked submit answer button`);
			mutex.runExclusive(() => this.handleAnswerSubmit(payload));
		});

		this.#interactions.action({
			type: 'button',
			actionId: 'twenty_questions_view_log_button',
		}, (payload: BlockAction) => {
			log.info(`${payload.user.name} clicked view log button`);
			this.handleViewLogButton(payload);
		});

		if (this.#state.currentGame) {
			this.scheduleGameEnd(this.#state.currentGame);
		}
	}

	public async startGame(userId: string) {
		if (this.#state.currentGame && this.#state.currentGame.status === 'active') {
			await this.#slack.chat.postEphemeral({
				channel: this.#SANDBOX_ID,
				user: userId,
				text: '既に進行中のゲームがあります。',
			});
			return;
		}

		log.info('Starting new game');

		// お題を選択中であることをユーザーに通知
		await this.#slack.chat.postEphemeral({
			channel: this.#SANDBOX_ID,
			user: userId,
			text: 'お題を選択中です⋯⋯',
		});

		const {topic, ruby} = await this.selectTopic();
		log.info(`Selected topic: ${topic} (ruby: ${ruby})`);

		const topicDescription = await this.generateTopicDescription(topic, ruby);
		log.info(`Generated topic description: ${topicDescription}`);

		const gameId = randomUUID();
		const now = Date.now();

		const newGame: GameState = {
			id: gameId,
			topic,
			topicRuby: ruby,
			topicDescription,
			status: 'active',
			startedAt: now,
			finishedAt: null,
			players: {},
			statusMessageTs: null,
		};

		this.#state.currentGame = newGame;

		const result = await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			text: '20の扉ゲーム開始！',
			blocks: gameStatusMessage(this.#state),
			username: '20の扉',
			icon_emoji: ':door:',
		});

		this.#state.currentGame.statusMessageTs = result.ts;

		this.scheduleGameEnd(newGame);
	}

	private async generateTopicDescription(topic: string, ruby: string): Promise<string> {
		log.info(`Generating description for topic: ${topic} (ruby: ${ruby})`);

		const completion = await openai.chat.completions.create({
			model: 'gpt-5-mini',
			messages: [
				{
					role: 'system',
					content:
						`あなたは「20の扉」の質問に答えるアシスタントです。正解となるお題は「${topic}」(読み: ${ruby})です。\n` +
						`\n` +
						`質問に対して統一した回答ができるよう、「${topic}」に関する基本的なデータを300文字程度でまとめてください。以下は説明の例です。「製法」の項目に「人工物」か「自然物」かを必ず含めてください。\n` +
						`\n` +
						`お題: 谷\n` +
						`説明: 山と山の間にある低くくぼんだ地形。川が流れることが多く、侵食によって形成される。\n` +
						`大きさ: 決まった大きさを持たないが、人間よりは遥かに大きい。小さいもので数十メートル、大きいものでは数千キロメートル程度。\n` +
						`組成: 無機物。土や岩などでできている。\n` +
						`色: 様々なものがある。代表的な色は、茶色・赤色・黄色など。\n` +
						`用途: 自然の地形であり、使用するものではない。\n` +
						`場所: 国や地方を問わず、さまざまな場所に存在する。\n` +
						`形: 山々に挟まれた細長い地形で、U字型やV字型などがある。\n` +
						`触感: 固い。地面や岩などの感触を持つ。\n` +
						`味: 味はない。食べることができない。\n` +
						`製法: 自然物であり、人為的に作られるものではない。\n` +
						`生誕: 地球の地殻変動や侵食作用によって数百万年から数十億年前に形成された。\n` +
						`\n` +
						`お題: オムライス\n` +
						`説明: チキンライスを薄焼き卵で包んだ日本発祥の洋食料理。明治時代末期から大正時代に考案されたとされる。\n` +
						`大きさ: 一人前で直径15〜20センチメートル程度、高さ5〜8センチメートル程度。手のひらに収まるサイズ。\n` +
						`組成: 有機物。たんぱく質、炭水化物、脂質などで構成される。\n` +
						`色: 外側は黄色(卵の色)。中身は赤色やオレンジ色(ケチャップライス)。上からかけるケチャップやデミグラスソースで赤色や茶色が加わることもあるが、全体的に見たら黄色いと言える。\n` +
						`用途: 食べ物。食事やランチとして提供される。\n` +
						`場所: 日本の洋食レストラン、喫茶店、カフェ、家庭など。現在は世界各地の日本食レストランでも見られる。\n` +
						`形: 楕円形や俵型が一般的。ふんわりとした半熟卵でとろとろに仕上げるスタイルもある。\n` +
						`触感: 外側は柔らかく滑らか。中のライスはほろほろとしている。温かい。\n` +
						`味: ケチャップの甘酸っぱさと卵のまろやかさが特徴。鶏肉や玉ねぎなどの具材の旨味もある。\n` +
						`製法: 人工物。主な材料はご飯、卵、鶏肉、玉ねぎ、ケチャップなど。\n` +
						`生誕: 明治時代末期から大正時代にかけて日本で考案された。\n` +
						`\n` +
						`お題: ハリネズミ\n` +
						`説明: 背中に針のような棘を持つ小型の哺乳類。夜行性で、危険を感じると体を丸めて棘で身を守る。昆虫や小動物を食べる雑食性。\n` +
						`大きさ: 体長15〜30センチメートル程度、体重400〜1200グラム程度。両手で抱えられるサイズ。\n` +
						`組成: 有機物。体は筋肉、骨、内臓などで構成され、脊椎動物に分類される。\n` +
						`色: 茶色、灰色、白色など。棘は茶色と白のまだら模様が一般的だが、品種により異なる。顔や腹部は薄い茶色や灰色。\n` +
						`用途: ペットとして飼育される。野生では害虫を食べるため生態系の一部として機能する。使役動物ではない。\n` +
						`場所: 野生ではヨーロッパ、アジア、アフリカの森林や草原に生息。日本には野生個体はいないが、ペットとして家庭で飼育される。\n` +
						`形: 丸みを帯びた体型で、尖った鼻と小さな耳を持つ。四本の短い脚がある。丸まると球状になる。\n` +
						`触感: 背中は針状の棘で覆われ、触ると硬くチクチクする。腹部は柔らかい毛で覆われている。温かい。\n` +
						`味: 味はない。ペット動物であり、食用ではない。\n` +
						`製法: 自然物であり、人為的に作られるものではない。\n` +
						`生誕: 種によるが、数百万年前から存在すると考えられている。`,
				},
				{
					role: 'user',
					content: `お題: ${topic}`,
				},
			],
			max_completion_tokens: 800,
			reasoning_effort: 'minimal',
		});

		const description = completion.choices[0]?.message?.content?.trim() || '';
		log.info(`Generated description: ${description}`);

		// 文字情報を連結
		const charInfo = this.analyzeCharacters(topic, ruby);
		const fullDescription = `${description}\n${charInfo}`;

		return fullDescription;
	}

	private async selectTopic(): Promise<{topic: string; ruby: string}> {
		log.info('Selecting topic from candidate words');

		const candidateWords = await getCandidateWords({min: 2, max: 10});

		// Step 1: 200個の候補から選ぶ処理を10回繰り返す
		const selectedWords: string[] = [];
		for (let i = 0; i < 10; i++) {
			const sampledWords = sampleSize(candidateWords, 200);
			const wordList = sampledWords.map(([word]) => word).join(' / ');

			const completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content:
							'あなたは「20の扉」ゲームのお題を選ぶアシスタントです。' +
							'提供された単語リストから、以下の条件を満たす最適な単語を1つ選んでください：\n' +
							'1. 名詞であること\n' +
							'2. 具体的な実体があるものを指す単語であること\n' +
							'3. 複合語(例: 「電気自動車」「あじさい園」「りんご売り」など)は避けること\n' +
							'4. なるべく簡単で、多くの人が知っている単語であること\n' +
							'5. 広すぎる意味を持つ単語(例: 「おもちゃ」「建物」「乗り物」「食べ物」「動物」など)は避け、より具体的な単語を選ぶこと\n' +
							'単語のみを回答してください。説明は不要です。',
					},
					{
						role: 'user',
						content: `単語リスト: ${wordList}`,
					},
				],
				max_tokens: 50,
			});

			const selected = completion.choices[0]?.message?.content?.trim() || sampledWords[0][0];
			selectedWords.push(selected);
			log.info(`Round ${i + 1}/10: Selected "${selected}"`);
		}

		// Step 2: 得られた10個の単語からさらに最適な1つを選ぶ
		const finalWordList = selectedWords.join(' / ');
		const finalCompletion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content:
						'あなたは「20の扉」ゲームのお題を選ぶアシスタントです。' +
						'提供された単語リストから、以下の条件を全て満たす単語のみを抽出し、スラッシュ (/) で区切ってください：\n' +
						'1. 名詞であること\n' +
						'2. 具体的な実体があるものを指す単語であること\n' +
						'3. 複合語(例: 「電気自動車」「あじさい園」「りんご売り」など)は避けること\n' +
						'4. なるべく簡単で、多くの人が知っている単語であること\n' +
						'5. 広すぎる意味を持つ単語(例: 「おもちゃ」「建物」「乗り物」「食べ物」「動物」など)は避け、より具体的な単語を選ぶこと\n' +
						'抽出された単語リストのみを回答してください。説明は不要です。',
				},
				{
					role: 'user',
					content: `単語リスト: ${finalWordList}`,
				},
			],
			max_tokens: 50,
		});

		const output = finalCompletion.choices[0]?.message?.content?.trim() || finalWordList;
		const candidates = output.split('/').map((w) => w.trim()).filter((w) => w.length > 0);
		log.info(`Final candidates: ${candidates}`);

		const topic = sample(candidates);
		log.info(`Final selected topic: ${topic} (from candidates: ${finalWordList})`);

		if (!topic) {
			throw new Error('トピックの選択に失敗しました');
		}

		// candidateWordsから選択されたお題の読みを取得
		const wordEntry = candidateWords.find(([word]) => word === topic);
		const ruby = wordEntry?.[1] || topic;

		return {topic, ruby};
	}

	private scheduleGameEnd(game: GameState) {
		const timeUntilEnd = game.startedAt + GAME_TIMEOUT - Date.now();

		if (timeUntilEnd <= 0) {
			mutex.runExclusive(() => this.endGame());
			return;
		}

		setTimeout(() => {
			mutex.runExclusive(() => this.endGame());
		}, timeUntilEnd);
	}

	private async endGame() {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		log.info('Ending game');

		this.#state.currentGame.status = 'finished';
		this.#state.currentGame.finishedAt = Date.now();

		await this.updateStatusMessage();

		await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
			reply_broadcast: true,
			text: `ゲーム終了！お題は「${this.#state.currentGame.topic}」でした。`,
			username: '20の扉',
			icon_emoji: ':door:',
		});

		await this.#slack.chat.postMessage({
			channel: this.#SANDBOX_ID,
			thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
			reply_broadcast: false,
			text: `【データシート】\n${this.#state.currentGame.topicDescription}`,
			username: '20の扉',
			icon_emoji: ':door:',
		});

		// ランキング1位の実績を付与
		const correctPlayers = Object.values(this.#state.currentGame.players)
			.filter((p) => p.score !== null)
			.sort((a, b) => a.score! - b.score!);

		if (correctPlayers.length > 0) {
			// 同率1位のプレイヤーを全て取得
			const bestScore = correctPlayers[0].score!;
			const firstPlacePlayers = correctPlayers.filter((p) => p.score === bestScore);

			// 参加者数を計算
			const participantCount = Object.values(this.#state.currentGame.players).filter(
				(p) => p.questionCount > 0,
			).length;

			// 1位の全プレイヤーに実績を付与
			for (const player of firstPlacePlayers) {
				await increment(player.userId, 'twenty-questions-first-place');

				// 5人以上参加している場合
				if (participantCount >= 5) {
					await increment(player.userId, 'twenty-questions-first-place-5plus-players');

					// 唯一の正解者である場合
					if (correctPlayers.length === 1) {
						await increment(player.userId, 'twenty-questions-only-correct-player-5plus-players');
					}
				}
			}
		}

		await this.saveGameToFirestore(this.#state.currentGame);
	}

	private async saveGameToFirestore(game: GameState) {
		const players = Object.values(game.players).map((player) => ({
			userId: player.userId,
			questionCount: player.questionCount,
			score: player.score,
			questions: player.questions,
		}));

		await TwentyQuestionsGames.add({
			id: game.id,
			topic: game.topic,
			topicRuby: game.topicRuby,
			topicDescription: game.topicDescription,
			startedAt: firestore.Timestamp.fromMillis(game.startedAt),
			finishedAt: firestore.Timestamp.fromMillis(game.finishedAt!),
			players,
		});

		log.info(`Game ${game.id} saved to Firestore`);
	}

	private async handleJoinButton(payload: BlockAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			await this.#slack.chat.postEphemeral({
				channel: payload.channel?.id ?? this.#SANDBOX_ID,
				user: payload.user.id,
				text: '現在進行中のゲームはありません。',
			});
			return;
		}

		const userId = payload.user.id;

		if (!this.#state.currentGame.players[userId]) {
			this.#state.currentGame.players[userId] = {
				userId,
				questions: [],
				questionCount: 0,
				isFinished: false,
				score: null,
			};

			await increment(userId, 'twenty-questions-participate');
		}

		const player = this.#state.currentGame.players[userId];

		await this.#slack.views.open({
			trigger_id: payload.trigger_id,
			view: playerModal(this.#state, player),
		});
	}

	private async handleViewLogButton(payload: BlockAction) {
		const action = 'actions' in payload && payload.actions?.[0];
		if (!action || !('value' in action)) {
			log.error('No action or value found in payload');
			return;
		}

		const gameId = action.value;
		if (!gameId) {
			log.error('No game ID found in button value');
			return;
		}

		log.info(`Fetching game log for game ID: ${gameId}`);

		const snapshot = await TwentyQuestionsGames.where('id', '==', gameId).limit(1).get();

		if (snapshot.empty) {
			await this.#slack.chat.postEphemeral({
				channel: payload.channel?.id ?? this.#SANDBOX_ID,
				user: payload.user.id,
				text: 'ゲームログが見つかりませんでした。',
			});
			return;
		}

		const gameData = snapshot.docs[0].data();

		await this.#slack.views.open({
			trigger_id: payload.trigger_id,
			view: gameLogModal(gameData),
		});
	}

	private async handleModalSubmit(payload: ViewSubmitAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		const userId = payload.user.id;
		const player = this.#state.currentGame.players[userId];

		if (!player || player.isFinished) {
			return;
		}

		// 質問回数が19回以上の場合は答えの送信のみ受け付ける
		if (player.questionCount >= 19) {
			const answerInput = payload.view?.state?.values?.answer_input?.answer_input_field;
			const answer = answerInput?.value?.trim();

			if (answer) {
				await this.handleAnswer(userId, player, answer, payload.view?.id);
			}
			return;
		}

		// 質問の送信
		const questionInput = payload.view?.state?.values?.question_input?.question_input_field;
		const question = questionInput?.value?.trim();

		if (question) {
			await this.handleQuestion(userId, player, question, payload.view?.id);
		}
	}

	private async handleQuestionSubmit(payload: BlockAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		const userId = payload.user.id;
		const player = this.#state.currentGame.players[userId];

		if (!player || player.isFinished) {
			return;
		}

		const questionInput = payload.view?.state?.values?.question_input?.question_input_field;
		const question = questionInput?.value?.trim();

		if (!question) {
			return;
		}

		await this.handleQuestion(userId, player, question, payload.view?.id);
	}

	private async handleAnswerSubmit(payload: BlockAction) {
		if (!this.#state.currentGame || this.#state.currentGame.status === 'finished') {
			return;
		}

		const userId = payload.user.id;
		const player = this.#state.currentGame.players[userId];

		if (!player || player.isFinished) {
			return;
		}

		const answerInput = payload.view?.state?.values?.answer_input?.answer_input_field;
		const answer = answerInput?.value?.trim();

		if (!answer) {
			return;
		}

		await this.handleAnswer(userId, player, answer, payload.view?.id);
	}

	private async handleQuestion(userId: string, player: PlayerState, question: string, viewId?: string) {
		if (!this.#state.currentGame) {
			return;
		}

		// 長さ制限のチェック
		if (question.length > MAX_QUESTION_LENGTH) {
			log.warn(`Question too long: ${question.length} characters`);
			return;
		}

		const topic = this.#state.currentGame.topic;
		const topicDescription = this.#state.currentGame.topicDescription;

		const completion = await openai.chat.completions.create({
			model: 'gpt-5-mini',
			messages: [
				{
					role: 'system',
					content:
						`あなたは「20の扉」ゲームのアシスタントです。正解となるお題は「${topic}」です。\n` +
						`\n` +
						`以下は、お題「${topic}」に関する基本的な情報です。この情報に基づいて、一貫した回答を行ってください：\n` +
						`${topicDescription}\n` +
						`\n` +
						`プレイヤーからの質問に対して、以下のいずれか一つのみで答えてください：\n` +
						`- はい\n` +
						`- いいえ\n` +
						`- どちらかと言えばはい\n` +
						`- どちらかと言えばいいえ\n` +
						`- どちらともいえない\n` +
						`- わかりません\n` +
						`- 答えられません\n` +
						`\n` +
						`重要な注意事項：\n` +
						`- 上記の基本情報を常に参照し、一貫した回答を心がけてください\n` +
						`- 「はい」または「いいえ」で答えられない質問（例：「答えはなんですか？」「中身は何ですか？」など）には必ず「答えられません」と答えてください\n` +
						`- 上記の7つの選択肢以外の回答は絶対にしないでください\n` +
						`- 説明や補足は一切不要です\n` +
						`- 句点（。）は付けても付けなくても構いません`,
				},
				...player.questions.filter((q) => !q.isAnswerAttempt).map((q) => [
					{
						role: 'user' as const,
						content: `お題: ${topic}\nプレイヤーからの質問: ${q.question}`,
					},
					{role: 'assistant' as const, content: q.answer},
				]).flat(),
				{
					role: 'user',
					content: `お題: ${topic}\nプレイヤーからの質問: ${question}`,
				},
			],
			max_completion_tokens: 50,
			reasoning_effort: 'minimal',
		});

		const rawAnswer = completion.choices[0]?.message?.content?.trim() || 'わかりません';
		const aiAnswer = this.validateAIResponse(rawAnswer);

		await increment(userId, 'twenty-questions-ask-question');

		// 重複質問のチェック
		const actualQuestions = player.questions.filter((q) => !q.isAnswerAttempt);
		const duplicateIndices = actualQuestions
			.map((q, index) => (q.question === question ? index : -1))
			.filter((index) => index !== -1);

		if (duplicateIndices.length > 0) {
			await increment(userId, 'twenty-questions-duplicate-question');

			// 異なる回答を得た場合
			if (duplicateIndices.some((duplicateIndex) => actualQuestions[duplicateIndex].answer !== aiAnswer)) {
				await increment(userId, 'twenty-questions-duplicate-question-different-answer');
			}

			// 10問以上前の質問と重複
			if (duplicateIndices.some((duplicateIndex) => duplicateIndex < actualQuestions.length - 10)) {
				await increment(userId, 'twenty-questions-duplicate-question-10plus-ago');
			}

			// 直前の質問と重複
			if (duplicateIndices.some((duplicateIndex) => duplicateIndex === actualQuestions.length - 1)) {
				await increment(userId, 'twenty-questions-duplicate-question-consecutive');
			}
		}

		player.questions.push({
			question,
			answer: aiAnswer,
			timestamp: Date.now(),
			isAnswerAttempt: false,
		});
		player.questionCount++;

		if (viewId) {
			await this.updatePlayerModal(viewId, player);
		}

		if (player.questionCount >= MAX_QUESTIONS) {
			await this.finishPlayer(userId, player, false);
		}

		await this.updateStatusMessage();
	}

	private async handleAnswer(userId: string, player: PlayerState, answer: string, viewId?: string) {
		if (!this.#state.currentGame) {
			return;
		}

		// 長さ制限のチェック
		if (answer.length > MAX_ANSWER_LENGTH) {
			log.warn(`Answer too long: ${answer.length} characters`);
			return;
		}

		const topic = this.#state.currentGame.topic;

		// Letter/Number以外の文字を除去して正規化
		const normalizedAnswer = this.normalizeAnswer(answer);
		const normalizedTopic = this.normalizeAnswer(topic);

		player.questionCount++;

		const completion = await openai.chat.completions.create({
			model: 'gpt-5-mini',
			messages: [
				{
					role: 'system',
					content:
						`あなたは「20の扉」ゲームの回答を判定するアシスタントです。` +
						`お題は「${normalizedTopic}」です。` +
						`プレイヤーの答え「${normalizedAnswer}」がお題と同一であるかどうかを判定してください。` +
						`「YES」または「NO」のみで答えてください。説明は不要です。`,
				},
				{
					role: 'user',
					content: `プレイヤーの答え: ${normalizedAnswer}\nお題: ${normalizedTopic}\n同一ですか？`,
				},
			],
			max_completion_tokens: 50,
			reasoning_effort: 'minimal',
		});

		log.info(`Answer evaluation completion: ${JSON.stringify(completion.choices[0]?.message)}`);

		const isCorrect =
			answer.trim().toUpperCase() !== 'YES' &&
			completion.choices[0]?.message?.content?.trim().toUpperCase() === 'YES';

		player.questions.push({
			question: `答え: ${answer}`,
			answer: isCorrect ? '正解！' : '不正解',
			timestamp: Date.now(),
			isAnswerAttempt: true,
			isCorrect,
		});

		if (viewId) {
			await this.updatePlayerModal(viewId, player);
		}

		if (isCorrect) {
			await this.finishPlayer(userId, player, true);
		} else if (player.questionCount >= MAX_QUESTIONS) {
			await this.finishPlayer(userId, player, false);
		}
	}

	private async finishPlayer(userId: string, player: PlayerState, isCorrect: boolean) {
		if (!this.#state.currentGame) {
			return;
		}

		player.isFinished = true;
		player.score = isCorrect ? player.questionCount : null;

		if (isCorrect) {
			await this.#slack.chat.postMessage({
				channel: this.#SANDBOX_ID,
				thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
				reply_broadcast: true,
				text: `<@${userId}> が ${player.questionCount} 問で正解しました！おめでとうございます！🎉`,
				username: '20の扉',
				icon_emoji: ':door:',
			});

			await increment(userId, 'twenty-questions-correct');
			await increment(userId, `twenty-questions-correct-${player.questionCount}`);

			if (player.questionCount <= 10) {
				await increment(userId, 'twenty-questions-correct-within-10');
			}

			if (player.questionCount <= 15) {
				await increment(userId, 'twenty-questions-correct-within-15');
			}

			const actualQuestions = player.questions.filter((q) => !q.isAnswerAttempt);

			if (actualQuestions.length > 0) {
				// すべて「はい」で正解
				const allYes = actualQuestions.every((q) => q.answer === 'はい');
				if (allYes) {
					await increment(userId, 'twenty-questions-correct-all-yes');
				}

				// すべて「いいえ」で正解
				const allNo = actualQuestions.every((q) => q.answer === 'いいえ');
				if (allNo) {
					await increment(userId, 'twenty-questions-correct-all-no');
				}

				// 「わかりません」が5回以上
				const wakaranaiCount = new Set(
					actualQuestions
						.filter((q) => q.answer === 'わかりません')
						.map((q) => q.question)
				).size;
				if (wakaranaiCount >= 5) {
					await increment(userId, 'twenty-questions-correct-5plus-wakaranai');
				}

				// 「答えられません」が5回以上
				const kotaerarenaiCount = new Set(
					actualQuestions
						.filter((q) => q.answer === '答えられません')
						.map((q) => q.question)
				).size;
				if (kotaerarenaiCount >= 5) {
					await increment(userId, 'twenty-questions-correct-5plus-kotaerarenai');
				}
			}
		} else {
			await this.#slack.chat.postMessage({
				channel: this.#SANDBOX_ID,
				thread_ts: this.#state.currentGame.statusMessageTs ?? undefined,
				reply_broadcast: true,
				text: `<@${userId}> が質問回数の上限に達しました`,
				username: '20の扉',
				icon_emoji: ':door:',
			});

			await this.#slack.chat.postEphemeral({
				channel: this.#SANDBOX_ID,
				user: userId,
				text: `残念！正解は「${this.#state.currentGame.topic}」でした。`,
			});

			await increment(userId, 'twenty-questions-fail');
		}

		await this.updateStatusMessage();
	}

	private async updateStatusMessage() {
		if (!this.#state.currentGame || !this.#state.currentGame.statusMessageTs) {
			return;
		}

		await this.#slack.chat.update({
			channel: this.#SANDBOX_ID,
			ts: this.#state.currentGame.statusMessageTs,
			text: '20の扉ゲーム',
			blocks: gameStatusMessage(this.#state),
		});
	}

	private async updatePlayerModal(viewId: string, player: PlayerState) {
		try {
			await this.#slack.views.update({
				view_id: viewId,
				view: playerModal(this.#state, player),
			});
		} catch (error) {
			// expired_trigger_idなどのエラーは無視（モーダルが既に閉じている可能性がある）
			log.warn(`Failed to update modal: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private analyzeCharacters(topic: string, ruby: string): string {
		const topicLength = Array.from(topic).length;
		const rubyLength = Array.from(ruby).length;

		const charTypes: string[] = [];
		const hasHiragana = /\p{Script=Hiragana}/u.test(topic);
		const hasKatakana = /\p{Script=Katakana}/u.test(topic);
		const hasKanji = /\p{Script=Han}/u.test(topic);
		const hasAlphabet = /\p{Script=Latin}/u.test(topic);
		const hasNumber = /\p{Number}/u.test(topic);

		if (hasHiragana) charTypes.push('ひらがな');
		if (hasKatakana) charTypes.push('カタカナ');
		if (hasKanji) charTypes.push('漢字');
		if (hasAlphabet) charTypes.push('アルファベット');
		if (hasNumber) charTypes.push('数字');

		const charTypesStr = charTypes.length > 0 ? charTypes.join('・') : 'その他';

		return [
			`文字数: ${topicLength}文字 (${Array.from(topic).map((c) => `「${c}」`).join('')})`,
			`読みの文字数: ${rubyLength}文字 (${Array.from(ruby).map((c) => `「${c}」`).join('')})`,
			`構成する文字種: ${charTypesStr}`,
		].join('\n');
	}

	private normalizeAnswer(text: string): string {
		// Unicode CategoryがLetterまたはNumberの文字のみを保持
		// \p{L} = Letter, \p{N} = Number
		return text.replace(/[^\p{L}\p{N}]/gu, '');
	}

	private validateAIResponse(response: string): string {
		const normalized = response.replace(/[。、]/g, '').trim();

		const validResponses = [
			'はい',
			'いいえ',
			'どちらかと言えばはい',
			'どちらかと言えばいいえ',
			'どちらともいえない',
			'わかりません',
			'答えられません',
		];

		if (validResponses.includes(normalized)) {
			return normalized;
		}

		log.warn(`Invalid AI response: "${response}", replacing with "答えられません"`);

		return '答えられません';
	}
}
