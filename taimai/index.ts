import { createMessageAdapter } from '@slack/interactive-messages';
import type { ChatUpdateArguments, WebClient } from '@slack/web-api';
import { Mutex } from 'async-mutex';
import { increment } from '../achievements';
import type { SlackInterface } from '../lib/slack';
import {EventEmitter} from 'events';
import State from '../lib/state';
import config from './config';
import announceGameEnd from './views/announceGameEnd';
import announceGameStart from './views/announceGameStart';
import dialogError from './views/dialogError';
import dialogFillPiece from './views/dialogFillPiece';
import instructionGame from './views/instructionGame';
import instructionTaimai from './views/instructionTaimai';
import statusCreation from './views/statusCreation';
import statusFinished from './views/statusFinished';
import statusOngoing from './views/statusOngoing';


export interface TaimaiGame {
	triggerTs: string;
	statusTs?: string;
	permalink: string;
	outline: string[];
	outlineAuthor: string;
	pieces: string[];
	pieceAuthors: string[];

	answer?: string;
	answerAuthor?: string;

	num_questions: number;
}

interface TaimaiState {
	games: TaimaiGame[];
}

interface PieceFillMeta {
	triggerTs: string,
	focus: number,
}

const mutex = new Mutex();

class Taimai {
	webClient: WebClient;
	eventClient: EventEmitter;
	messageClient: ReturnType<typeof createMessageAdapter>;

	state: TaimaiState;

	constructor({
		webClient,
		eventClient,
		messageClient,
	}: {
		webClient: WebClient,
		eventClient: EventEmitter,
		messageClient: ReturnType<typeof createMessageAdapter>,
	}) {
		this.webClient = webClient;
		this.eventClient = eventClient;
		this.messageClient = messageClient;
	}

	async initialize() {
		this.state = await State.init<TaimaiState>('taimai', {
			games: [],
		});
		this.eventClient.on('message', async (message) => {
			mutex.runExclusive(() => this.onMessage(message));
		});

		for (let i = 0; i < config.placeholders.length; i++) {
			this.messageClient.action({
				type: 'button',
				actionId: `taimai_show_fill_modal_${i}`,
			}, (payload: any) => {
				mutex.runExclusive(() => {
					this.showFillInPieceModal(payload);
				});
			});
		}


		this.messageClient.viewSubmission('taimai_fill_piece', (payload: any) => {
			mutex.runExclusive(() => {
				this.fillInPiece(payload);
			});
		});
	}

	async postMessage(message: {text?: string, thread_ts: string, reply_broadcast?: boolean}) {
		return await this.webClient.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: "玳瑁",
			icon_emoji: ":turtle:",
			text: "お使いの環境でこのメッセージは閲覧できないようです。",
			...message,
			reply_broadcast: message.reply_broadcast ?? false,
		});
	}

	async editMessage(ts: string, message: Partial<ChatUpdateArguments>) {
		return await this.webClient.chat.update({
			ts,
			channel: process.env.CHANNEL_SANDBOX,
			text: "お使いの環境でこのメッセージは閲覧できないようです。",
			...message,
		});
	}

	async showErrorModal(triggerID: string, message: string) {
		this.webClient.views.open({
			trigger_id: triggerID,
			view: dialogError(message),
		});
	}

	getGame(triggerTs: string): TaimaiGame {
		return this.state.games.find(game => game.triggerTs == triggerTs);
	}

	async terminateGame(game: TaimaiGame) {
		this.state.games = this.state.games.filter(g => g.triggerTs !== game.triggerTs);
		await this.editMessage(game.statusTs, {
			...statusFinished(game)
		});
	}

	async onMessage(message: any) {
		if (message.channel !== process.env.CHANNEL_SANDBOX || !message.text) {
			return;
		} else if (message.subtype === 'bot_message' || message.subtype === 'slackbot_response' || message.bot_id) {
			return;
		}
		const newQuestionMatch = message.text.match(config.newQuestionTrigger);
		// non-thread commands
		if (newQuestionMatch) {
			const question = newQuestionMatch.groups['question'];
			await this.initiateNewQuestion(question, message);
			return;
		} else if (message.text.match(config.helpTrigger)) {
			await this.showHelp(message.ts);
			return;
		}
		// in-thread commands
		const game = this.getGame(message.thread_ts);
		if (!message.thread_ts || !game || game.pieces.some(piece => !piece)) {
			return;
		}
		if (message.text.match(config.askTrigger)) {
			this.onAsk(game, message);
		} else if (message.text.match(config.answerTrigger)) {
			this.onAnswer(game, message);
		} else if (message.text.match(config.surrenderTrigger)) {
			this.onSurrender(game, message);
		}
	}

	async initiateNewQuestion(question: string, trigger: any) {
		if (this.getGame(trigger.ts)) {
			return; // duplicate message?
		} else if (question.length > config.maxQuestionChars) {
			await this.postMessage({text: '問題が長すぎるよ :blob-cry:', thread_ts: trigger.ts});
			return;
		} else if (question.includes('[][]')) {
			await this.postMessage({text: '成立した文章を作るために、空欄と空欄の間には少なくとも1文字入れてね :blob-cry:', thread_ts: trigger.ts});
			return;
		} else if (config.bannedChars.some(c => question.includes(c))) {
			await this.postMessage({text: `使えない文字が含まれています :blob-cry:`, thread_ts: trigger.ts});
			return;
		} else if (config.maxConcurrentGame <= this.state.games.length) {
			await this.postMessage({text: `同時に作成できるセッションは${config.maxConcurrentGame}個までだよ :blob-cry:`, thread_ts: trigger.ts});
			return;
		}
		let outline = question.split('[]');
		if (outline.length - 1 > config.placeholders.length) {
			await this.postMessage({text: '空欄の個数が多すぎるよ :blob-cry:', thread_ts: trigger.ts});
			return;
		}
		increment(trigger.user, 'taimai-contribute-quiz');
		const pieces = Array(outline.length - 1);
		const game: TaimaiGame = {
			triggerTs: trigger.ts,
			permalink: '',
			statusTs: null,
			outline: outline,
			outlineAuthor: trigger.user,
			pieces: pieces,
			pieceAuthors: Array(outline.length - 1),
			num_questions: 0,
		};

		const message = await this.postMessage({
			thread_ts: trigger.ts, 
			reply_broadcast: true, 
			...(pieces.length === 0 ? statusOngoing : statusCreation)(game)
		});
		if (pieces.length === 0) {
			await this.postMessage({
				thread_ts: trigger.ts, 
				...announceGameStart(game)
			});
			await this.postMessage({
				thread_ts: trigger.ts, 
				...instructionGame()
			});
		}
		game.statusTs = message.ts;
		const permalinkResp = await this.webClient.chat.getPermalink({channel: trigger.channel, message_ts: message.ts});
		game.permalink = permalinkResp.permalink || '';
		this.state.games.push(game);
	}

	async showFillInPieceModal(payload: any) {
		const triggerTs = payload.message.root.ts;
		const triggerID = payload.trigger_id;
		const focus = Number(payload.actions[0].action_id.slice(-1));
		const game = this.getGame(triggerTs);
		if (!game) {
			this.showErrorModal(triggerID, 'このタイマイセッションは終了したか削除されました。');
			return;
		} else if (game.outlineAuthor == payload.user.id || game.pieceAuthors.includes(payload.user.id)) {
			this.showErrorModal(triggerID, 'あなたは既にこの問題の空欄を埋めています。');
			return;
		} else if (focus < 0 || game.outline.length - 1 < focus || game.pieces[focus]) {
			this.showErrorModal(triggerID, 'この空欄は既に誰かによって埋められてしまいました。');
			return;
		}
		const meta = {triggerTs, focus} as PieceFillMeta;
		this.webClient.views.open({
			trigger_id: triggerID,
			view: {
				private_metadata: JSON.stringify(meta),
				...dialogFillPiece(game, focus)
			},
		});
	}

	async fillInPiece(payload: any) {
		const stateObjects = Object.values(payload?.view?.state?.values ?? {});
		const state = Object.assign({}, ...stateObjects);
		const piece = state['taimai_fill_piece'].value;
		const {triggerTs, focus} = JSON.parse(payload?.view?.private_metadata) as PieceFillMeta;
		const game = this.getGame(triggerTs);
		const triggerID = payload.trigger_id;
		
		if (!game) {
			this.showErrorModal(triggerID, 'このタイマイセッションは終了したか削除されました。');
			return;
		} else if (game.outlineAuthor == payload.user.id || game.pieceAuthors.includes(payload.user.id)) {
			this.showErrorModal(triggerID, 'あなたは既にこの問題の空欄を埋めています。');
			return;
		} else if (focus < 0 || game.outline.length - 1 < focus || game.pieces[focus]) {
			this.showErrorModal(triggerID, 'この空欄は既に誰かによって埋められてしまいました。');
			return;
		} else if (piece.length > config.maxPieceChars) {
			this.showErrorModal(triggerID, '文字数が多すぎます。');
			return;
		}else if (piece.length === 0) {
			this.showErrorModal(triggerID, '文字数が少なすぎます。');
			return;
		}

		game.pieceAuthors[focus] = payload.user.id;
		game.pieces[focus] = piece;
		
		await this.postMessage({
			text: `<@${payload.user.id}>が${config.placeholders[focus]}番の空欄を埋めた :turtle:`, 
			thread_ts: triggerTs,
			reply_broadcast: true
		});
		increment(payload.user.id, 'taimai-contribute-quiz');
		if (game.pieces.every(p => p)) {
			await this.editMessage(game.statusTs, {
				...statusOngoing(game)
			});
			await this.postMessage({
				thread_ts: triggerTs, 
				reply_broadcast: true,
				...announceGameStart(game)
			});
			await this.postMessage({
				thread_ts: triggerTs, 
				...instructionGame()
			});
		} else {
			await this.editMessage(game.statusTs, {
				...statusCreation(game)
			});
		}
	}

	async onAsk(game: TaimaiGame, payload: any) {
		if (Math.random() < config.askProbability) {
			this.webClient.reactions.add({
				name: 'o',
				channel: payload.channel,
				timestamp: payload.ts,
			});
		} else {
			this.webClient.reactions.add({
				name: 'x',
				channel: payload.channel,
				timestamp: payload.ts,
			});
		}
		increment(payload.user, 'taimai-ask');
		game.num_questions++;
	}

	async onAnswer(game: TaimaiGame, payload: any) {
		const c = config.answerProbability;
		const x = game.num_questions;
		const p = (c.max - c.min) * (1 - 2 / (Math.exp(c.grow * x) + Math.exp(-c.grow * x))) + c.min;
		game.num_questions++;
		if (Math.random() >= p) {
			this.webClient.reactions.add({
				name: 'x',
				channel: payload.channel,
				timestamp: payload.ts,
			});
			return;
		}
		
		const answer = payload.text.match(config.answerTrigger).groups['answer'];
		game.answer = answer;
		game.answerAuthor = payload.user;
		await this.terminateGame(game);
		await this.postMessage({
			thread_ts: game.triggerTs, 
			reply_broadcast: true,
			...announceGameEnd(game)
		});
		await this.webClient.reactions.add({
			name: 'o',
			channel: payload.channel,
			timestamp: payload.ts,
		});

		increment(payload.user, 'taimai-correct-answer');
		if (game.num_questions === 0) {
			increment(payload.user, 'taimai-0q');
		}
		if (game.num_questions <= 3) {
			increment(payload.user, 'taimai-lt3q');
		}
		if (game.num_questions >= 25) {
			increment(payload.user, 'taimai-gt25q');
		}
	}

	async onSurrender(game: TaimaiGame, payload: any) {
		game.answer = config.ultimateAnswer;
		game.answerAuthor = payload.user;
		await this.terminateGame(game);
		await this.postMessage({
			thread_ts: game.triggerTs, 
			reply_broadcast: true,
			...announceGameEnd(game)
		});
		await this.webClient.reactions.add({
			name: 'o',
			channel: payload.channel,
			timestamp: payload.ts,
		});
	}

	async showHelp(threadTs: string=null) {
		await this.postMessage({thread_ts: threadTs, ...instructionTaimai(this.state.games)});
	}
}

export default async ({webClient, messageClient, eventClient}: SlackInterface) => {
	const taimai = new Taimai({webClient, messageClient, eventClient});
	await taimai.initialize();
};
