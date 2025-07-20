import {File} from 'buffer';
import {readFile} from 'fs/promises';
import path from 'path';
import type {BlockButtonAction, ViewSubmitAction} from '@slack/bolt';
import {SlackMessageAdapter} from '@slack/interactive-messages';
import type {ImageElement, KnownBlock, WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {oneLine, stripIndent} from 'common-tags';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
// @ts-expect-error: Not typed
import {hiraganize} from 'japanese';
import yaml from 'js-yaml';
import {last, minBy} from 'lodash';
import {scheduleJob} from 'node-schedule';
import type {OpenAI} from 'openai';
import type {ChatCompletion, ChatCompletionCreateParams} from 'openai/resources/chat';
import {increment} from '../achievements';
import logger from '../lib/logger';
import openai from '../lib/openai';
import type {SlashCommandEndpoint, SlackInterface} from '../lib/slack';
import State from '../lib/state';
import {Loader} from '../lib/utils';
import {getUserIcon, getUserMention, getUserName} from './util';
import answerQuestionDialog from './views/answerQuestionDialog';
import footer from './views/footer';
import gameDetailsDialog from './views/gameDetailsDialog';
import listQuizDialog from './views/listQuizDialog';
import postCommentDialog from './views/postCommentDialog';
import registerQuizDialog from './views/registerQuizDialog';

export type Genre = 'normal' | 'strange' | 'anything';

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
	progressOfComplete: number,
	completed: boolean,
	days: number,
	correctAnswers: Submission[],
	wrongAnswers: Submission[],
	comments: Submission[],
	answeredUsers: string[],

	genre: Genre,
}

interface BatchJob {
	id: string,
	gameId: string,
	model: 'gpt-4o-mini' | 'o4-mini',
	status: 'pending' | 'in_progress' | 'completed' | 'failed',
	createdAt: number,
	completedAt?: number,
	response?: string,
	answer?: string,
}

// https://platform.openai.com/docs/api-reference/batch/request-input
interface BatchRequest<Body> {
	custom_id: string,
	method: 'POST',
	url: string,
	body: Body,
}

// https://platform.openai.com/docs/api-reference/batch/request-output
interface BatchResponse<Body> {
	custom_id: string,
	response: {
		body: Body,
		request_id: string,
		status_code: number,
	},
	error?: {
		message: string,
		code: string,
	},
}

export interface StateObj {
	games: Game[],
	latestStatusMessages: {ts: string, channel: string}[],
	batchJobs: BatchJob[],
}

const mutex = new Mutex();

export const getGenreText = (genre: Genre) => {
	if (genre === 'strange') {
		return '変化球';
	}
	if (genre === 'normal') {
		return '正統派';
	}
	return 'なんでも';
};

export const validateQuestion = (question: string) => {
	if (question.split('/').length >= 5) {
		return question.split('/').length <= 90;
	}

	const normalizedQuestion = question.replaceAll(/【.*?】/g, '');

	return Array.from(normalizedQuestion).length <= 90;
};

const promptLoader = new Loader<OpenAI.Chat.ChatCompletionMessageParam[]>(async () => {
	const promptYaml = await readFile(path.join(__dirname, 'prompt.yml'));
	const prompt = yaml.load(promptYaml.toString()) as OpenAI.Chat.ChatCompletionMessageParam[];
	return prompt;
});

const reasoningPromptLoader = new Loader<OpenAI.Chat.ChatCompletionMessageParam[]>(async () => {
	const promptYaml = await readFile(path.join(__dirname, 'prompt-reasoning.yml'));
	const prompt = yaml.load(promptYaml.toString()) as OpenAI.Chat.ChatCompletionMessageParam[];
	return prompt;
});

const log = logger.child({bot: 'slow-quiz'});

export class SlowQuiz {
	readonly #slack: WebClient;

	readonly #slackInteractions: SlackMessageAdapter;

	#state: StateObj;

	readonly #MAX_CORRECT_ANSWERS = 3;

	readonly #MAX_O4_MINI_OUTPUT_TOKENS = 3000;

	constructor({
		slack,
		slackInteractions,
	}: {
		slack: WebClient,
		slackInteractions: SlackMessageAdapter,
	}) {
		this.#slack = slack;
		this.#slackInteractions = slackInteractions;
	}

	async initialize() {
		this.#state = await State.init<StateObj>('slow-quiz', {
			games: [],
			latestStatusMessages: [],
			batchJobs: [],
		});

		this.#slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_register_quiz_button',
		}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => (
				this.#showRegisterQuizDialog({
					triggerId: payload?.trigger_id,
				})
			));
		});

		this.#slackInteractions.viewSubmission('slowquiz_register_quiz_dialog', (payload: ViewSubmitAction) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.#registerQuiz({
					question: state?.question?.value,
					answer: state?.answer?.value,
					ruby: state?.ruby?.value,
					hint: state?.hint?.value,
					user: payload?.user?.id,
					genre: state?.genre?.selected_option?.value,
				})
			));
		});

		this.#slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_list_quiz_button',
		}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => (
				this.#showListQuizDialog({
					triggerId: payload?.trigger_id,
					user: payload?.user?.id,
				})
			));
		});

		this.#slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_delete_quiz_button',
		}, (payload: BlockButtonAction) => {
			const action = (payload?.actions ?? []).find((a) => (
				a.action_id === 'slowquiz_delete_quiz_button'
			));
			mutex.runExclusive(() => (
				this.#deleteQuiz({
					viewId: payload?.view?.id,
					id: action?.value,
					user: payload?.user?.id,
				})
			));
		});

		this.#slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_answer_question_button',
		}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => (
				this.#showAnswerQuestionDialog({
					triggerId: payload.trigger_id,
					id: payload?.actions?.[0]?.value,
					user: payload?.user?.id,
					channel: payload?.channel?.id,
				})
			));
		});

		this.#slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_show_game_details_button',
		}, (payload: BlockButtonAction) => {
			mutex.runExclusive(() => (
				this.#showGameDetailsDialog({
					triggerId: payload.trigger_id,
					id: payload?.actions?.[0]?.value,
					user: payload?.user?.id,
					channel: payload?.channel?.id,
				})
			));
		});

		this.#slackInteractions.viewSubmission('slowquiz_answer_question_dialog', (payload: ViewSubmitAction) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);
			const id = payload?.view?.private_metadata;

			mutex.runExclusive(() => (
				this.#answerUserQuestion({
					id,
					ruby: state?.ruby?.value,
					user: payload.user.id,
				})
			));
		});

		this.#slackInteractions.action({
			type: 'button',
			actionId: 'slowquiz_post_comment_submit_comment',
		}, (payload: BlockButtonAction) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.#postComment({
					id: payload?.view?.private_metadata,
					viewId: payload?.view?.id,
					comment: state?.slowquiz_post_comment_input_comment?.value,
					type: 'user',
					user: payload?.user?.id,
				})
			));
		});

		this.#slackInteractions.viewSubmission('slowquiz_post_comment_dialog', (payload: ViewSubmitAction) => {
			const stateObjects = Object.values(payload?.view?.state?.values ?? {});
			const state = Object.assign({}, ...stateObjects);

			mutex.runExclusive(() => (
				this.#postComment({
					id: payload?.view?.private_metadata,
					viewId: payload?.view?.id,
					comment: state?.slowquiz_post_comment_input_comment?.value,
					type: 'user',
					user: payload?.user?.id,
				})
			));
		});
	}

	#showRegisterQuizDialog({triggerId}: {triggerId: string}) {
		return this.#slack.views.open({
			trigger_id: triggerId,
			view: registerQuizDialog,
		});
	}

	#showListQuizDialog({triggerId, user}: {triggerId: string, user: string}) {
		const games = this.#state.games.filter((game) => (
			game.author === user && game.status === 'waitlisted'
		));
		return this.#slack.views.open({
			trigger_id: triggerId,
			view: listQuizDialog(games),
		});
	}

	#showAnswerQuestionDialog({
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
		const game = this.#state.games.find((g) => g.id === id);

		if (!game) {
			this.#postEphemeral('Error: 問題が見つかりません', user, channel);
			return null;
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}

		if (game.author === user) {
			return this.#slack.views.open({
				trigger_id: triggerId,
				view: gameDetailsDialog(game),
			});
		}

		if (game.status !== 'inprogress') {
			this.#postEphemeral('この問題の解答受付は終了しているよ🙄', user, channel);
			return null;
		}

		if (game.answeredUsers.includes(user)) {
			return this.#slack.views.open({
				trigger_id: triggerId,
				view: postCommentDialog(game, user),
			});
		}

		if (game.correctAnswers.some((answer) => answer.user === user)) {
			return this.#slack.views.open({
				trigger_id: triggerId,
				view: postCommentDialog(game, user),
			});
		}

		return this.#slack.views.open({
			trigger_id: triggerId,
			view: answerQuestionDialog(game, this.#getQuestionText(game), user),
		});
	}

	async #registerQuiz({
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
			this.#postEphemeral('問題を入力してね🙄', user);
			return;
		}

		if (typeof answer !== 'string' || answer.length === 0) {
			this.#postEphemeral('答えを入力してね🙄', user);
			return;
		}

		if (typeof ruby !== 'string' || !(/^[ぁ-ゟァ-ヿa-z0-9,]+$/i).exec(ruby)) {
			this.#postEphemeral('読みがなに使える文字は「ひらがな・カタカナ・英数字」のみだよ🙄', user);
			return;
		}

		if (!validateQuestion(question)) {
			this.#postEphemeral('問題文の長さは原則90文字以下だよ🙄', user);
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

		this.#state.games.push({
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

		await this.#postShortMessage({
			text: `${getUserMention(user)}が1日1文字クイズの問題を登録したよ💪`,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `${getUserMention(user)}が1日1文字クイズの問題を登録したよ💪`,
					},
				},
			],
		});
	}

	async #getChatGptAnswer(game: Game) {
		log.info(`Getting ChatGPT answer for game ${game.id}...`);
		const prompt = await promptLoader.load();
		const questionText = this.#getQuestionText(game);
		const [visibleText] = questionText.split('\u200B');

		log.info('Requesting to OpenAI API...');
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				...prompt,
				{
					role: 'user',
					content: [
						'ありがとうございます。以下の文章も、クイズの問題文の途中までを表示したものです。この文章の続きを推測し、問題の答えと読みを教えてください。',
						'',
						`問題: ${visibleText}`,
					].join('\n'),
				},
			],
			max_tokens: 1024,
		});
		log.info(`OpenAI API response: ${JSON.stringify(completion)}`);

		const result = completion.choices?.[0]?.message?.content;
		if (typeof result !== 'string') {
			return {
				answer: null,
				result: null,
			};
		}

		const answer = this.#extractAnswerFromResponse(result, completion.model);

		return {
			answer,
			result,
		};
	}

	async #createO4MiniBatchJob(game: Game) {
		log.info(`Creating o4-mini batch job for game ${game.id}...`);
		const prompt = await reasoningPromptLoader.load();
		const questionText = this.#getQuestionText(game);
		const [visibleText] = questionText.split('\u200B');

		const botId = 'o4-mini:ver1';
		const userId = `bot:${botId}`;

		const wrongAnswers = game.wrongAnswers
			.filter((answer) => answer.user === userId)
			.map((answer) => answer.answer);

		const requestBody: ChatCompletionCreateParams = {
			model: 'o4-mini',
			messages: [
				...prompt,
				{
					role: 'user',
					content: [
						`問題文: ${visibleText}`,
						`残り文字数: ${game.progressOfComplete - game.progress}`,
						`これまでの誤答: ${wrongAnswers.length > 0 ? wrongAnswers.join(', ') : 'なし'}`,
					].join('\n'),
				},
			],
			// 25,000 is recommended, but it will be too expensive for this game
			// Input tokens: $0.55 / 1M * 2,000 = $0.0011
			// Output tokens: $2.20 / 1M * 3,000 = $0.0066
			max_completion_tokens: this.#MAX_O4_MINI_OUTPUT_TOKENS,
		};

		// https://platform.openai.com/docs/api-reference/batch/request-input
		const batchRequest: BatchRequest<ChatCompletionCreateParams> = {
			custom_id: `slowquiz_${game.id}_day${game.days}`,
			method: 'POST',
			url: '/v1/chat/completions',
			body: requestBody,
		};

		try {
			const batch = await openai.batches.create({
				input_file_id: await this.#createBatchFile([batchRequest]),
				endpoint: '/v1/chat/completions',
				completion_window: '24h',
			});

			const batchJob: BatchJob = {
				id: batch.id,
				gameId: game.id,
				model: 'o4-mini',
				status: 'pending',
				createdAt: Date.now(),
			};

			this.#state.batchJobs.push(batchJob);
			log.info(`Created batch job ${batch.id} for game ${game.id}`);
		} catch (error) {
			log.error(`Failed to create batch job for game ${game.id}:`, error);
		}
	}

	async #createBatchFile(requests: unknown[]) {
		const jsonlContent = requests.map((req) => JSON.stringify(req)).join('\n');
		const file = await openai.files.create({
			file: new File([jsonlContent], 'batch_requests.jsonl', {type: 'application/jsonl'}),
			purpose: 'batch',
		});
		return file.id;
	}

	async checkBatchJobs() {
		log.info('Checking batch jobs...');

		for (const batchJob of this.#state.batchJobs) {
			if (batchJob.status === 'pending' || batchJob.status === 'in_progress') {
				try {
					const batch = await openai.batches.retrieve(batchJob.id);
					log.info(`Batch job ${batchJob.id} status: ${batch.status}`);

					if (batch.status === 'completed') {
						batchJob.status = 'completed';
						batchJob.completedAt = Date.now();
						await this.#processBatchResults(batchJob, batch);
					} else if (batch.status === 'failed') {
						batchJob.status = 'failed';
						log.error(`Batch job ${batchJob.id} failed`);
					} else if (batch.status === 'in_progress') {
						batchJob.status = 'in_progress';
					}
				} catch (error) {
					log.error(`Error checking batch job ${batchJob.id}:`, error);
				}
			}
		}
	}

	async #processBatchResults(batchJob: BatchJob, batch: OpenAI.Batches.Batch) {
		log.info(`Processing batch results for job ${batchJob.id}...`);
		const game = this.#state.games.find((g) => g.id === batchJob.gameId);
		if (!game) {
			log.error(`Game ${batchJob.gameId} not found for batch job ${batchJob.id}`);
			return;
		}

		if (game.status !== 'inprogress') {
			log.info(`Game ${game.id} is not in progress, skipping batch result processing`);
			return;
		}

		const botId = 'o4-mini:ver1';
		const userId = `bot:${botId}`;

		if (game.correctAnswers.some((answer) => answer.user === userId)) {
			log.info(`Game ${game.id} already has an o4-mini answer, skipping`);
			return;
		}

		try {
			const outputFile = await openai.files.content(batch.output_file_id);
			const outputText = await outputFile.text();
			const results = outputText.split('\n').filter((line) => line.trim());

			for (const resultLine of results) {
				const result: BatchResponse<ChatCompletion> = JSON.parse(resultLine);

				if (result.custom_id !== `slowquiz_${game.id}_day${game.days}`) {
					log.warn(`Unexpected custom_id in batch result: ${result.custom_id} (expected: slowquiz_${game.id}_day${game.days})`);
				}

				if (result.response?.body?.usage?.completion_tokens_details?.reasoning_tokens === this.#MAX_O4_MINI_OUTPUT_TOKENS) {
					log.warn(`Batch job ${batchJob.id} response has ${this.#MAX_O4_MINI_OUTPUT_TOKENS} reasoning tokens, which means it might exceeded the limit. The response might be incomplete.`);
				}

				const content = result.response?.body?.choices?.[0]?.message?.content;
				log.info(`Batch job ${batchJob.id} response content: ${content}`);

				if (content) {
					batchJob.response = content;
					const answer = this.#extractAnswerFromResponse(content, batchJob.model);
					batchJob.answer = answer;

					log.info(`O4-mini answer for game ${game.id}: ${answer} (${content})`);
					log.info(`Prompt tokens: ${result.response?.body?.usage?.prompt_tokens}`);
					log.info(`Completion tokens: ${result.response?.body?.usage?.completion_tokens}`);
					log.info(`Reasoning tokens: ${result.response?.body?.usage?.completion_tokens_details?.reasoning_tokens}`);

					if (answer !== null) {
						this.#answerQuestion({
							type: 'bot',
							game,
							ruby: answer,
							user: botId,
						});
					}

					if (content !== null) {
						await this.#postComment({
							id: game.id,
							viewId: '',
							comment: content,
							type: 'bot',
							user: botId,
						});
					}
					break;
				}
			}
		} catch (error) {
			log.error(`Error processing batch results for job ${batchJob.id}:`, error);
		}
	}

	#extractAnswerFromResponse(content: string, model: string): string | null {
		if (model === 'o4-mini') {
			const matches = (/最終解答[:：]\s*(?<answer>.+?)(?<rubyParens>（(?<ruby>.+?)）)?$/m).exec(content);
			if (matches?.groups?.ruby) {
				return matches.groups.ruby.replaceAll(/[^ぁ-ゟァ-ヿa-z0-9]/ig, '') ?? null;
			}
			if (matches?.groups?.answer) {
				return matches.groups.answer.replaceAll(/[^ぁ-ゟァ-ヿa-z0-9]/ig, '') ?? null;
			}
			return null;
		}

		let answer = null;
		const answerMatches = (/【(?<answer>.+?)】/).exec(content);
		if (answerMatches?.groups?.answer) {
			answer = answerMatches.groups.answer;
		}

		const rubyMatches = (/[（(](?<ruby>.+?)[）)]/).exec(answer ?? '');
		if (rubyMatches?.groups?.ruby) {
			answer = rubyMatches.groups.ruby;
		}

		answer = answer?.replaceAll(/[^ぁ-ゟァ-ヿa-z0-9]/ig, '');

		if (!answer) {
			answer = null;
		}

		return answer;
	}

	#answerUserQuestion({
		id,
		ruby,
		user,
	}: {
		id: string,
		ruby: string,
		user: string,
	}) {
		const game = this.#state.games.find((g) => g.id === id);

		if (!game) {
			this.#postEphemeral('Error: 問題が見つかりません', user);
			return;
		}

		if (game.author === user) {
			this.#postEphemeral('出題者は問題に答えることができないよ🙄', user);
			return;
		}

		if (game.status !== 'inprogress' || game.correctAnswers.length >= this.#MAX_CORRECT_ANSWERS) {
			this.#postEphemeral('Error: この問題の解答受付は終了しています', user);
			return;
		}

		if (game.answeredUsers.includes(user)) {
			this.#postEphemeral('Error: この問題にすでに解答しています', user);
			return;
		}

		if (!(/^[ぁ-ゟァ-ヿa-z0-9]+$/i).exec(ruby)) {
			this.#postEphemeral('答えに使える文字は「ひらがな・カタカナ・英数字」のみだよ🙄', user);
			return;
		}

		this.#answerQuestion({
			type: 'user',
			game,
			ruby,
			user,
		});
	}

	async #createBotAnswers() {
		log.info('Creating bot answers...');
		for (const game of this.#state.games) {
			log.info(`Processing game ${game.id}...`);
			const botId = 'chatgpt-4o-mini:ver1';
			const userId = `bot:${botId}`;

			if (game.status !== 'inprogress') {
				log.info(`Game ${game.id} is not in progress, skipping...`);
				continue;
			}

			if (game.correctAnswers.some((answer) => answer.user === userId)) {
				log.info(`Game ${game.id} already has a bot answer, skipping...`);
				continue;
			}

			const {answer, result} = await this.#getChatGptAnswer(game);
			log.info(`Bot answer for game ${game.id}: ${answer} (${result})`);

			if (answer !== null) {
				this.#answerQuestion({
					type: 'bot',
					game,
					ruby: answer,
					user: botId,
				});
			}

			if (result !== null) {
				await this.#postComment({
					id: game.id,
					viewId: '',
					comment: result,
					type: 'bot',
					user: botId,
				});
			}
		}
	}

	async #createO4MiniBatchJobs() {
		log.info('Creating o4-mini batch jobs...');
		for (const game of this.#state.games) {
			if (game.status !== 'inprogress') {
				continue;
			}

			const existingBatchJob = this.#state.batchJobs.find((job) => (
				job.gameId === game.id && job.model === 'o4-mini' && job.status === 'pending'
			));

			if (existingBatchJob) {
				log.info(`Game ${game.id} already has a batch job, skipping...`);
				continue;
			}

			const botId = 'o4-mini:ver1';
			const userId = `bot:${botId}`;

			if (game.correctAnswers.some((answer) => answer.user === userId)) {
				log.info(`Game ${game.id} already has an o4-mini answer, skipping...`);
				continue;
			}

			await this.#createO4MiniBatchJob(game);
		}
	}

	#answerQuestion({
		type,
		game,
		ruby,
		user,
	}: {
		type: 'user' | 'bot',
		game: Game,
		ruby: string,
		user: string,
	}) {
		const userId = type === 'user' ? user : `bot:${user}`;
		const userMention = getUserMention(userId);

		game.answeredUsers.push(userId);

		const normalizedRuby: string = hiraganize(ruby).toLowerCase().trim();
		const isCorrect = game.ruby.split(',').some((correctAnswer) => {
			const normalizedCorrectRuby: string = hiraganize(correctAnswer).toLowerCase().trim();
			return normalizedRuby === normalizedCorrectRuby;
		});

		if (!isCorrect) {
			game.wrongAnswers ??= [];
			game.wrongAnswers.push({
				user: userId,
				progress: game.progress,
				days: game.days,
				date: Date.now(),
				answer: ruby,
			});
			if (type === 'user') {
				this.#postEphemeral('残念！🙄', user);
				increment(user, 'slowquiz-wrong-answer');
			}
			this.#updateLatestStatusMessages();
			return;
		}

		game.correctAnswers.push({
			user: userId,
			progress: game.progress,
			days: game.days,
			date: Date.now(),
			answer: ruby,
		});

		if (type === 'user') {
			this.#postEphemeral('正解です🎉🎉🎉', user);
		}

		this.#postShortMessage({
			text: `${userMention}が1日1文字クイズに正解しました🎉🎉🎉`,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `${userMention}が1日1文字クイズに正解しました🎉🎉🎉`,
					},
				},
				{
					type: 'context',
					elements: [
						{
							type: 'plain_text',
							text: this.#getQuestionText(game),
						},
					],
				},
			],
		});

		if (type === 'user') {
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
		}

		if (type === 'bot') {
			increment(game.author, 'slowquiz-correct-answer-by-bot');
			if (game.correctAnswers.length === 1) {
				increment(game.author, 'slowquiz-first-correct-answer-by-bot');
			}
		}

		this.#checkGameEnd();

		this.#updateLatestStatusMessages();
	}

	async #postComment({
		id,
		viewId,
		comment,
		type,
		user,
	}: {
		id: string,
		viewId: string,
		comment: string,
		type: 'user' | 'bot',
		user: string,
	}) {
		const game = this.#state.games.find((g) => g.id === id);
		const userId = type === 'user' ? user : `bot:${user}`;

		if (!game) {
			if (type === 'user') {
				this.#postEphemeral('Error: 問題が見つかりません', user);
			}
			return;
		}

		if (game.status === 'finished') {
			if (type === 'user') {
				this.#postEphemeral('Error: この問題の解答受付は終了しています', user);
			}
			return;
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}

		game.comments.push({
			user: userId,
			progress: game.progress,
			days: game.days,
			date: Date.now(),
			answer: comment,
		});

		if (type === 'user') {
			await this.#slack.views.update({
				view_id: viewId,
				view: postCommentDialog(game, user),
			});
		}
	}

	#deleteQuiz({viewId, id, user}: {viewId: string, id: string, user: string}) {
		const gameIndex = this.#state.games.findIndex((g) => g.id === id);

		if (gameIndex === -1) {
			this.#postEphemeral('Error: 問題が見つかりません', user);
			return null;
		}

		const removedGame = this.#state.games[gameIndex];
		if (removedGame.status !== 'waitlisted') {
			this.#postEphemeral('Error: 出題待ちの問題ではありません', user);
			return null;
		}

		this.#state.games.splice(gameIndex, 1);

		const games = this.#state.games.filter((game) => (
			game.author === user && game.status === 'waitlisted'
		));
		return this.#slack.views.update({
			view_id: viewId,
			view: listQuizDialog(games),
		});
	}

	#showGameDetailsDialog({
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
		const game = this.#state.games.find((g) => g.id === id);

		if (!game) {
			this.#postEphemeral('Error: 問題が見つかりません', user, channel);
			return null;
		}

		if (!Array.isArray(game.comments)) {
			game.comments = [];
		}

		if (game.status !== 'finished') {
			this.#postEphemeral('Error: この問題は終了していません', user, channel);
			return null;
		}

		return this.#slack.views.open({
			trigger_id: triggerId,
			view: gameDetailsDialog(game),
		});
	}

	async progressGames() {
		const newGame = this.#chooseNewGame();

		if (newGame !== null) {
			newGame.status = 'inprogress';
			newGame.startDate = Date.now();
		}

		for (const game of this.#state.games) {
			if (game.status === 'inprogress') {
				game.progress++;
				game.days++;

				const {text} = this.#getVisibleQuestionText(game);
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

		await this.#checkGameEnd();
		if (this.#state.games.some((game) => game.status === 'inprogress')) {
			await this.postGameStatus(true);
		}
		await this.#createBotAnswers();
		await this.#createO4MiniBatchJobs();
	}

	async postGameStatus(replaceLatestStatusMessages: boolean, channels: string[] = []) {
		const blocks = await this.#getGameBlocks();
		const messages = await this.#postMessage(
			{
				text: '現在開催中の1日1文字クイズ一覧',
				blocks,
			},
			...(channels.length > 0 ? [channels] : []),
		);

		const newStatusMessages = messages.map((message) => ({
			ts: message.ts,
			channel: message.channel,
		}));

		if (replaceLatestStatusMessages) {
			this.#state.latestStatusMessages = newStatusMessages;
		} else {
			this.#state.latestStatusMessages.push(...newStatusMessages);
		}
	}

	#chooseNewGame() {
		// これまでの出題者のリスト
		const authorHistory = this.#state.games
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
		const unchosenGames = this.#state.games
			.filter((game) => !authorHistorySet.has(game.author) && game.status === 'waitlisted');

		if (unchosenGames.length > 0) {
			return minBy(unchosenGames, (game) => game.registrationDate);
		}

		// 最近選ばれていないユーザーを優先して選ぶ
		for (const author of uniqueAuthorHistory.slice().reverse()) {
			const authorGames = this.#state.games
				.filter((game) => game.author === author && game.status === 'waitlisted');
			if (authorGames.length > 0) {
				return minBy(authorGames, (game) => game.registrationDate);
			}
		}

		// あきらめ
		return null;
	}

	async #checkGameEnd() {
		for (const game of this.#state.games) {
			if (game.status !== 'inprogress') {
				continue;
			}

			if (
				game.correctAnswers.length >= this.#MAX_CORRECT_ANSWERS ||
				(game.progress > game.progressOfComplete && game.completed)
			) {
				game.status = 'finished';
				game.finishDate = Date.now();

				this.#postMessage({
					text: '1日1文字クイズの解答受付が終了しました',
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

									出題者: ${getUserMention(game.author)}
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
							type: 'context' as const,
							elements: [
								{
									type: 'mrkdwn' as const,
									text: `*${i + 1}位* ${getUserMention(answer.user)} (${answer.progress}文字)`,
								},
								{
									type: 'image' as const,
									image_url: await getUserIcon(answer.user),
									alt_text: await getUserName(answer.user),
								},
							],
						}))),
					],
				});
			}
		}
	}

	async #updateLatestStatusMessages() {
		const blocks = [
			...await this.#getGameBlocks(),
			...footer,
		];

		for (const message of this.#state.latestStatusMessages) {
			await this.#slack.chat.update({
				ts: message.ts,
				channel: message.channel,
				text: '現在開催中の1日1文字クイズ一覧',
				blocks,
			});
		}
	}

	async #getGameBlocks(): Promise<KnownBlock[]> {
		const ongoingGames = this.#state.games
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
			const questionText = this.#getQuestionText(game);

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
							${await getUserName(game.author)} さんの問題 /
							【${getGenreText(game.genre)}】 /
							本日${game.answeredUsers.length}人解答 /
							${game.correctAnswers.length}人正解済み
						`,
					},
					...await Promise.all(game.correctAnswers.map(async (correctAnswer) => ({
						type: 'image',
						image_url: (await getUserIcon(correctAnswer.user)) ?? 'https://slack.com/img/icons/app-57.png',
						alt_text: (await getUserName(correctAnswer.user)) ?? 'ユーザー',
					} as ImageElement))),
				],
			});
		}

		return blocks;
	}

	#getQuestionText(game: Game) {
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
		const {text, invisibleCharacters} = this.#getVisibleQuestionText(game);
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

	#getVisibleQuestionText(game: Game) {
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

	async #postMessage(
		message: {text: string, blocks: KnownBlock[]},
		channels: string[] = [process.env.CHANNEL_SANDBOX, process.env.CHANNEL_QUIZ],
	) {
		const messages = [];

		for (const channel of channels) {
			const response = await this.#slack.chat.postMessage({
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

	#postShortMessage(message: {text: string, blocks?: KnownBlock[]}) {
		return this.#slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: '1日1文字クイズ',
			icon_emoji: ':face_with_rolling_eyes:',
			...message,
		});
	}

	#postEphemeral(message: string, user: string, channel: string = process.env.CHANNEL_SANDBOX) {
		return this.#slack.chat.postEphemeral({
			channel,
			text: message,
			user,
		});
	}
}

export const server = ({webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	const callback: FastifyPluginCallback = async (fastify, opts, next) => {
		const slowquiz = new SlowQuiz({slack, slackInteractions});
		await slowquiz.initialize();

		fastify.post<SlashCommandEndpoint>('/slash/slow-quiz', (req, res) => {
			if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				res.code(400);
				return 'Bad Request';
			}

			mutex.runExclusive(async () => {
				log.info('Received /slow-quiz command');
				await slowquiz.postGameStatus(false, [req.body.channel_id]);
			});

			return {
				response_type: 'in_channel',
				text: 'Working...',
			};
		});

		scheduleJob('0 10 * * *', () => {
			mutex.runExclusive(() => {
				slowquiz.progressGames();
			});
		});

		// Check batch jobs every hour
		scheduleJob('30 * * * *', () => {
			mutex.runExclusive(() => {
				slowquiz.checkBatchJobs();
			});
		});

		next();
	};

	return plugin(callback);
};
