import {SlackMessageAdapter} from '@slack/interactive-messages';
import type {ChatPostMessageArguments, ImageElement, KnownBlock, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {oneLine, stripIndent} from 'common-tags';
// @ts-expect-error
import {hiraganize} from 'japanese';
import {last, minBy} from 'lodash';
import {scheduleJob} from 'node-schedule';
import {increment} from '../achievements';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import State from '../lib/state';
import answerQuestionDialog from './views/answerQuestionDialog';
import footer from './views/footer';
import gameDetailsDialog from './views/gameDetailsDialog';
import listQuizDialog from './views/listQuizDialog';
import postCommentDialog from './views/postCommentDialog';
import registerQuizDialog from './views/registerQuizDialog';

type Genre = 'normal' | 'strange' | 'anything';

export interface Submission {
	user: string,
	progress: number,
	days: number,
	date: number,
	answer: string,
}

export interface Game {
	id: string,
	status: 'waitlisted' | 'inprogress' | 'finished',
	author: string,

	question: string,
	answer: string,
	ruby: string,
	hint: string | null,

	registrationDate: number,
	startDate: number | null,
	finishDate: number | null,

	progress: number,
	progressOfComplete?: number, // 一度 progressGames が実行された後に optional を外す
	completed?: boolean, // 同上
	days: number,
	correctAnswers: Submission[],
	wrongAnswers: Submission[],
	comments: Submission[],
	answeredUsers: string[],

	genre: Genre,
}

interface StateObj {
	games: Game[],
	latestStatusMessages: {ts: string, channel: string}[],
}

const mutex = new Mutex();

const getGenreText = (genre: Genre) => {
	if (genre === 'strange') {
		return '変化球';
	}
	if (genre === 'normal') {
		return '正統派';
	}
	return 'なんでも';
};

const validateQuestion = (question: string) => {
	if (question.split('/').length >= 5) {
		return question.split('/').length <= 90;
	}

	const normalizedQuestion = question.replaceAll(/【.*?】/g, '');
	console.log({normalizedQuestion});

	return Array.from(normalizedQuestion).length <= 90;
};

class SlowQuiz {
	slack: WebClient;

	slackInteractions: SlackMessageAdapter;

	state: StateObj;

	previousTick: number;

	MAX_CORRECT_ANSWERS = 3;

	constructor({
		slack,
		slackInteractions,
	}: {
		slack: WebClient,
		slackInteractions: any,
	}) {
		this.slack = slack;
		this.slackInteractions = slackInteractions;
		this.previousTick = 0;
	}

	async initialize() {
		this.state = await State.init<StateObj>('slow-quiz', {
			games: [],
			latestStatusMessages: [],
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_register_quiz_button',
		}, (payload: any) => {
			mutex.runExclusive(() => (
				this.showRegisterQuizDialog({
					triggerId: payload?.trigger_id,
				})
			));
		});

		this.slackInteractions.viewSubmission('slowquiz_register_quiz_dialog', (payload: any) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.registerQuiz({
					question: state?.question?.value,
					answer: state?.answer?.value,
					ruby: state?.ruby?.value,
					hint: state?.hint?.value,
					user: payload?.user?.id,
					genre: state?.genre?.selected_option?.value,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_list_quiz_button',
		}, (payload: any) => {
			mutex.runExclusive(() => (
				this.showListQuizDialog({
					triggerId: payload?.trigger_id,
					user: payload?.user?.id,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_delete_quiz_button',
		}, (payload: any) => {
			const action = (payload?.actions ?? []).find((a: any) => (
				a.action_id === 'slowquiz_delete_quiz_button'
			));
			mutex.runExclusive(() => (
				this.deleteQuiz({
					viewId: payload?.view?.id,
					id: action?.value,
					user: payload?.user?.id,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_answer_question_button',
		}, (payload: any) => {
			mutex.runExclusive(() => (
				this.showAnswerQuestionDialog({
					triggerId: payload.trigger_id,
					id: payload?.actions?.[0]?.value,
					user: payload?.user?.id,
					channel: payload?.channel?.id,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_show_game_details_button',
		}, (payload: any) => {
			mutex.runExclusive(() => (
				this.showGameDetailsDialog({
					triggerId: payload.trigger_id,
					id: payload?.actions?.[0]?.value,
					user: payload?.user?.id,
					channel: payload?.channel?.id,
				})
			));
		});

		this.slackInteractions.viewSubmission('slowquiz_answer_question_dialog', (payload: any) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);
			const id = payload?.view?.private_metadata;

			mutex.runExclusive(() => (
				this.answerQuestion({
					id,
					ruby: state?.ruby?.value,
					user: payload.user.id,
				})
			));
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_post_comment_submit_comment',
		}, (payload) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.postComment({
					id: payload?.view?.private_metadata,
					viewId: payload?.view?.id,
					comment: state?.slowquiz_post_comment_input_comment?.value,
					user: payload?.user?.id,
				})
			));
		});

		this.slackInteractions.viewSubmission('slowquiz_post_comment_dialog', (payload: any) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.postComment({
					id: payload?.view?.private_metadata,
					viewId: payload?.view?.id,
					comment: state?.slowquiz_post_comment_input_comment?.value,
					user: payload?.user?.id,
				})
			));
		});
	}

	showRegisterQuizDialog({triggerId}: {triggerId: string}) {
		return this.slack.views.open({
			trigger_id: triggerId,
			view: registerQuizDialog,
		});
	}

	showListQuizDialog({triggerId, user}: {triggerId: string, user: string}) {
		const games = this.state.games.filter((game) => (
			game.author === user && game.status === 'waitlisted'
		));
		return this.slack.views.open({
			trigger_id: triggerId,
			view: listQuizDialog(games),
		});
	}

	showAnswerQuestionDialog({
		triggerId,
		id,
		user,
		channel,
	}: {
		triggerId: string,
		id: string,
		user: string,
		channel: string,
	}) {
		const game = this.state.games.find((g) => g.id === id);

		if (!game) {
			this.postEphemeral('Error: 問題が見つかりません', user, channel);
			return null;
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}

		if (game.author === user) {
			return this.slack.views.open({
				trigger_id: triggerId,
				view: gameDetailsDialog(game),
			});
		}

		if (game.status !== 'inprogress') {
			this.postEphemeral('この問題の解答受付は終了しているよ🙄', user, channel);
			return null;
		}

		if (game.answeredUsers.includes(user)) {
			return this.slack.views.open({
				trigger_id: triggerId,
				view: postCommentDialog(game, user),
			});
		}

		if (game.correctAnswers.some((answer) => answer.user === user)) {
			return this.slack.views.open({
				trigger_id: triggerId,
				view: postCommentDialog(game, user),
			});
		}

		return this.slack.views.open({
			trigger_id: triggerId,
			view: answerQuestionDialog(game, this.getQuestionText(game), user),
		});
	}

	async registerQuiz({
		question,
		answer,
		ruby,
		hint,
		user,
		genre,
	}: {
		question: string,
		answer: string,
		ruby: string,
		hint: string,
		user: string,
		genre: Genre,
	}): Promise<void> {
		if (typeof question !== 'string' || question.length === 0) {
			this.postEphemeral('問題を入力してね🙄', user);
			return;
		}

		if (typeof answer !== 'string' || answer.length === 0) {
			this.postEphemeral('答えを入力してね🙄', user);
			return;
		}

		if (typeof ruby !== 'string' || !ruby.match(/^[ぁ-ゟァ-ヿa-z0-9,]+$/i)) {
			this.postEphemeral('読みがなに使える文字は「ひらがな・カタカナ・英数字」のみだよ🙄', user);
			return;
		}

		if (!validateQuestion(question)) {
			this.postEphemeral('問題文の長さは原則90文字以下だよ🙄', user);
			return;
		}

		// progressOfComplete の決定
		let progressOfComplete = 0;
		if (question.split('/').length >= 5) {
			progressOfComplete = question.split('/').length;
		} else {
			progressOfComplete = question.length;
			const lastCharacter = last(Array.from(question));
			if (
				['。', '？', '?'].includes(lastCharacter)
			) {
				progressOfComplete--;
			}
		}

		this.state.games.push({
			id: Math.floor(Math.random() * 10000000000).toString(),
			question,
			answer,
			ruby,
			hint: hint || null,
			author: user,
			registrationDate: Date.now(),
			startDate: null,
			finishDate: null,
			status: 'waitlisted',
			progress: 0,
			progressOfComplete,
			completed: false,
			days: 0,
			correctAnswers: [],
			wrongAnswers: [],
			answeredUsers: [],
			comments: [],
			genre,
		});

		increment(user, 'slowquiz-register-quiz');

		await this.postShortMessage({
			text: `<@${user}>が1日1文字クイズの問題を登録したよ💪`,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `<@${user}>が1日1文字クイズの問題を登録したよ💪`,
					},
				},
			],
		});
	}

	answerQuestion({
		id,
		ruby,
		user,
	}: {
		id: string,
		ruby: string,
		user: string,
	}): Promise<void> {
		const game = this.state.games.find((g) => g.id === id);

		if (!game) {
			this.postEphemeral('Error: 問題が見つかりません', user);
			return null;
		}

		if (game.author === user) {
			this.postEphemeral('出題者は問題に答えることができないよ🙄', user);
			return null;
		}

		if (game.status !== 'inprogress' || game.correctAnswers.length >= this.MAX_CORRECT_ANSWERS) {
			this.postEphemeral('Error: この問題の解答受付は終了しています', user);
			return null;
		}

		if (game.answeredUsers.includes(user)) {
			this.postEphemeral('Error: この問題にすでに解答しています', user);
			return null;
		}

		if (!ruby.match(/^[ぁ-ゟァ-ヿa-z0-9]+$/i)) {
			this.postEphemeral('答えに使える文字は「ひらがな・カタカナ・英数字」のみだよ🙄', user);
			return null;
		}

		game.answeredUsers.push(user);

		const normalizedRuby: string = hiraganize(ruby).toLowerCase().trim();
		const isCorrect = game.ruby.split(',').some((correctAnswer) => {
			const normalizedCorrectRuby: string = hiraganize(correctAnswer).toLowerCase().trim();
			return normalizedRuby === normalizedCorrectRuby;
		});

		if (!isCorrect) {
			if (game.wrongAnswers === undefined) {
				game.wrongAnswers = [];
			}
			game.wrongAnswers.push({
				user,
				progress: game.progress,
				days: game.days,
				date: Date.now(),
				answer: ruby,
			});
			this.postEphemeral('残念！🙄', user);
			increment(user, 'slowquiz-wrong-answer');
			this.updateLatestStatusMessages();
			return null;
		}

		game.correctAnswers.push({
			user,
			progress: game.progress,
			days: game.days,
			date: Date.now(),
			answer: ruby,
		});

		this.postEphemeral('正解です🎉🎉🎉', user);

		this.postShortMessage({
			text: `<@${user}>が1日1文字クイズに正解しました🎉🎉🎉`,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `<@${user}>が1日1文字クイズに正解しました🎉🎉🎉`,
					},
				},
				{
					type: 'context',
					elements: [
						{
							type: 'plain_text',
							text: this.getQuestionText(game),
						},
					],
				},
			],
		});

		increment(user, 'slowquiz-correct-answer');
		if (game.days === 1) {
			increment(user, 'slowquiz-correct-answer-first-letter');
			if (game.genre === 'normal' && game.question.split('/').length < 5) {
				increment(user, 'slowquiz-normal-correct-answer-first-letter');
			}
		}
		if (game.days <= 3) {
			increment(user, 'slowquiz-correct-answer-le-third-letter');
		}
		if (game.correctAnswers.length === 1) {
			increment(user, 'slowquiz-first-correct-answer');
		}

		this.checkGameEnd();

		this.updateLatestStatusMessages();

		return null;
	}

	postComment({
		id,
		viewId,
		comment,
		user,
	}: {
		id: string,
		viewId: string,
		comment: string,
		user: string,
	}) {
		const game = this.state.games.find((g) => g.id === id);

		if (!game) {
			this.postEphemeral('Error: 問題が見つかりません', user);
			return null;
		}

		if (game.status === 'finished') {
			this.postEphemeral('Error: この問題の解答受付は終了しています', user);
			return null;
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}

		game.comments.push({
			user,
			progress: game.progress,
			days: game.days,
			date: Date.now(),
			answer: comment,
		});

		return this.slack.views.update({
			view_id: viewId,
			view: postCommentDialog(game, user),
		});
	}

	deleteQuiz({viewId, id, user}: {viewId: string, id: string, user: string}) {
		const gameIndex = this.state.games.findIndex((g) => g.id === id);

		if (gameIndex === -1) {
			this.postEphemeral('Error: 問題が見つかりません', user);
			return null;
		}

		const removedGame = this.state.games[gameIndex];
		if (removedGame.status !== 'waitlisted') {
			this.postEphemeral('Error: 出題待ちの問題ではありません', user);
			return null;
		}

		this.state.games.splice(gameIndex, 1);

		const games = this.state.games.filter((game) => (
			game.author === user && game.status === 'waitlisted'
		));
		return this.slack.views.update({
			view_id: viewId,
			view: listQuizDialog(games),
		});
	}

	showGameDetailsDialog({
		triggerId,
		id,
		user,
		channel,
	}: {
		triggerId: string,
		id: string,
		user: string,
		channel: string,
	}) {
		const game = this.state.games.find((g) => g.id === id);

		if (!game) {
			this.postEphemeral('Error: 問題が見つかりません', user, channel);
			return null;
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}

		if (game.status !== 'finished') {
			this.postEphemeral('Error: この問題は終了していません', user, channel);
			return null;
		}

		return this.slack.views.open({
			trigger_id: triggerId,
			view: gameDetailsDialog(game),
		});
	}

	async progressGames() {
		const newGame = this.chooseNewGame();

		if (newGame !== null) {
			newGame.status = 'inprogress';
			newGame.startDate = Date.now();
		}

		for (const game of this.state.games) {
			if (game.status === 'inprogress') {
				game.progress++;
				game.days++;

				const {text} = this.getVisibleQuestionText(game);
				// 括弧で終わるならもう1文字
				if ((last(Array.from(text)) ?? '').match(/^[\p{Ps}\p{Pe}]$/u)) {
					game.progress++;
				}
				if (game.progress === game.progressOfComplete && !game.completed) {
					game.completed = true;
					if (game.correctAnswers.length > 0) {
						increment(game.author, 'slowquiz-complete-quiz');
					}
				}
			}
			game.answeredUsers = [];
		}

		await this.checkGameEnd();

		if (this.state.games.some((game) => game.status === 'inprogress')) {
			const blocks = await this.getGameBlocks();
			const messages = await this.postMessage({
				text: '現在開催中の1日1文字クイズ一覧',
				blocks,
			});

			this.state.latestStatusMessages = messages.map((message) => ({
				ts: message.ts,
				channel: message.channel,
			}));
		}
	}

	chooseNewGame() {
		// これまでの出題者のリスト
		const authorHistory = this.state.games
			.filter((game) => game.status !== 'waitlisted')
			.sort((a, b) => b.startDate - a.startDate)
			.map((game) => game.author);

		// 最近選ばれた順の出題者のリスト
		const uniqueAuthorHistory: string[] = [];
		for (const author of authorHistory) {
			if (!uniqueAuthorHistory.includes(author)) {
				uniqueAuthorHistory.push(author);
			}
		}

		// 一度も選ばれてないユーザーの問題から選ぶ
		const authorHistorySet = new Set(authorHistory);
		const unchosenGames = this.state.games
			.filter((game) => !authorHistorySet.has(game.author) && game.status === 'waitlisted');

		if (unchosenGames.length > 0) {
			return minBy(unchosenGames, (game) => game.registrationDate);
		}

		// 最近選ばれていないユーザーを優先して選ぶ
		for (const author of uniqueAuthorHistory.slice().reverse()) {
			const authorGames = this.state.games
				.filter((game) => game.author === author && game.status === 'waitlisted');
			if (authorGames.length > 0) {
				return minBy(authorGames, (game) => game.registrationDate);
			}
		}

		// あきらめ
		return null;
	}

	async checkGameEnd() {
		for (const game of this.state.games) {
			if (game.status !== 'inprogress') {
				continue;
			}

			if (
				game.correctAnswers.length >= this.MAX_CORRECT_ANSWERS ||
				(game.progress > game.progressOfComplete && game.completed)
			) {
				game.status = 'finished';
				game.finishDate = Date.now();

				this.postMessage({
					blocks: [
						{
							type: 'header',
							text: {
								type: 'plain_text',
								text: '～解答受付終了～',
								emoji: true,
							},
						},
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: stripIndent`
									＊Q. ${game.question}＊

									＊A. ${game.answer} (${game.ruby})＊

									出題者: <@${game.author}>
								`,
							},
							accessory: {
								type: 'button',
								text: {
									type: 'plain_text',
									text: '詳細情報',
									emoji: true,
								},
								value: game.id,
								style: 'primary',
								action_id: 'slowquiz_show_game_details_button',
							},
						},
						{
							type: 'header',
							text: {
								type: 'plain_text',
								text: '正解者一覧',
								emoji: true,
							},
						},
						...await Promise.all(game.correctAnswers.map(async (answer, i) => ({
							type: 'context',
							elements: [
								{
									type: 'mrkdwn',
									text: `*${i + 1}位* <@${answer.user}> (${answer.progress}文字)`,
								},
								{
									type: 'image',
									image_url: await getMemberIcon(answer.user),
									alt_text: await getMemberName(answer.user),
								},
							],
						}))),
					],
				});
			}
		}
	}

	async updateLatestStatusMessages() {
		const blocks = [
			...await this.getGameBlocks(),
			...footer,
		];

		for (const message of this.state.latestStatusMessages) {
			await this.slack.chat.update({
				ts: message.ts,
				channel: message.channel,
				text: '現在開催中の1日1文字クイズ一覧',
				blocks,
			});
		}
	}

	async getGameBlocks(): Promise<KnownBlock[]> {
		const ongoingGames = this.state.games
			.filter((game) => game.status === 'inprogress')
			.sort((a, b) => a.startDate - b.startDate);

		if (ongoingGames.length === 0) {
			return [{
				type: 'section',
				text: {
					type: 'plain_text',
					text: '現在開催中の1日1文字クイズはないよ！',
				},
			}];
		}

		const blocks: KnownBlock[] = [];

		for (const game of ongoingGames) {
			const questionText = this.getQuestionText(game);

			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `＊Q. ${questionText}＊`,
				},
				accessory: {
					type: 'button',
					text: {
						type: 'plain_text',
						text: '解答する',
						emoji: true,
					},
					value: game.id,
					style: 'primary',
					action_id: 'slowquiz_answer_question_button',
				},
			});

			blocks.push({
				type: 'context',
				elements: [
					{
						type: 'mrkdwn',
						text: oneLine`
							${await getMemberName(game.author)} さんの問題 /
							【${getGenreText(game.genre)}】 /
							本日${game.answeredUsers.length}人解答 /
							${game.correctAnswers.length}人正解済み
						`,
					},
					...await Promise.all(game.correctAnswers.map(async (correctAnswer) => ({
						type: 'image',
						image_url: await getMemberIcon(correctAnswer.user),
						alt_text: await getMemberName(correctAnswer.user),
					} as ImageElement))),
				],
			});
		}

		return blocks;
	}

	getQuestionText(game: Game) {
		if (game.question.split('/').length >= 5) {
			const tokens = game.question.split('/');

			const visibleTokens = tokens.slice(0, game.progress);
			const invisibleTokens = tokens.slice(game.progress);

			const visibleText = visibleTokens.join('');
			const invisibleText = invisibleTokens.map((token, i) => (
				Array.from(token).map((char, j, tokenChars) => {
					if (
						i === invisibleTokens.length - 1 &&
						j === tokenChars.length - 1 &&
						['。', '？', '?'].includes(char)
					) {
						return char;
					}
					return '◯';
				}).join('\u200B')
			)).join('/');

			return `${visibleText}\u200B${invisibleText}`;
		}

		const lastCharacter = last(Array.from(game.question));
		const {text, invisibleCharacters} = this.getVisibleQuestionText(game);
		const invisibleText = Array(invisibleCharacters).fill('').map((char, i) => {
			if (
				i === invisibleCharacters - 1 &&
				['。', '？', '?'].includes(lastCharacter)
			) {
				return lastCharacter;
			}
			return '◯';
		}).join('\u200B');

		return `${text}\u200B${invisibleText}`;
	}

	getVisibleQuestionText(game: Game) {
		if (game.question.split('/').length >= 5) {
			return {text: '', invisibleCharacters: 0};
		}

		const characters = Array.from(game.question);
		let text = '';
		let progress = 0;
		let isInParenthesis = false;
		let invisibleCharacters = 0;
		for (const character of characters) {
			if (progress >= game.progress) {
				progress++;
				invisibleCharacters++;
			} else {
				text += character;
				if (isInParenthesis) {
					if (character === '】') {
						isInParenthesis = false;
					}
				} else {
					if (character === '【') {
						isInParenthesis = true;
					} else {
						progress++;
					}
				}
			}
		}

		return {text, invisibleCharacters};
	}

	async postMessage(message: Partial<ChatPostMessageArguments>) {
		const messages = [];

		for (const channel of [process.env.CHANNEL_SANDBOX, process.env.CHANNEL_QUIZ]) {
			const response = await this.slack.chat.postMessage({
				channel,
				username: '1日1文字クイズ',
				icon_emoji: ':face_with_rolling_eyes:',
				...message,
				blocks: [
					...(message.blocks ?? []),
					...footer,
				],
			});
			messages.push(response);
		}

		return messages;
	}

	postShortMessage(message: Partial<ChatPostMessageArguments>) {
		return this.slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: '1日1文字クイズ',
			icon_emoji: ':face_with_rolling_eyes:',
			...message,
		});
	}

	postEphemeral(message: string, user: string, channel: string = process.env.CHANNEL_SANDBOX) {
		return this.slack.chat.postEphemeral({
			channel,
			text: message,
			user,
		});
	}
}

export default async ({webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	const slowquiz = new SlowQuiz({slack, slackInteractions});
	await slowquiz.initialize();

	scheduleJob('0 10 * * *', () => {
		mutex.runExclusive(() => {
			slowquiz.progressGames();
		});
	});
};
