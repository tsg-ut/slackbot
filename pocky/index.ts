import axios from 'axios';
import * as emoji from 'node-emoji';
import {get} from 'lodash';
import {stripIndents} from 'common-tags';
import {unlock, increment} from '../achievements/index.js';
import logger from '../lib/logger';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {extractMessage, getMemberName, isGenericMessage} from '../lib/slackUtils';
import State from '../lib/state';
import {Deferred} from '../lib/utils';
import type {SlackInterface} from '../lib/slack';
import type {GenericMessageEvent, MessageEvent} from '@slack/bolt';
import {
	generateQuiz,
	isCorrectAnswer,
	revealHint,
	type PockyQuiz,
} from './quiz';

const log = logger.child({bot: 'pocky'});

const stripRe = /^[、。？！,.，．…・?!：；:;\s]+|[、。？！,.，．…・?!：；:;\s]+$/g;

const ignoreRe = /( 英語| 韓国語| 中国語|の?意味|meaning|とは)+$/i;

async function getSuggestions(text: string): Promise<string[]> {
	const response = await axios({
		url: "https://www.google.com/complete/search",
		params: {
			client: "firefox",
			hl: "ja",
			q: text,
		},
		headers: {
			"User-Agent": "Mozilla/5.0",
		},
		method: "GET",
	});
	return get(response, ['data', 1], []);
}

async function reply(text: string, index: number): Promise<string | null> {
	try {
		const suggestions = await getSuggestions(text);
		return generateReply(text, suggestions, index);
	} catch (e) {
		log.error(e);
		return "エラーΩ＼ζ°)ﾁｰﾝ";
	}
}

function generateReply(text: string, words: string[], index: number): string | null {
	const strippedText = text.replace(stripRe, "");
	const normalizedText = normalize(strippedText);
	const isAlphabet = /[a-z]$/.test(normalizedText);
	const trailers = words.map((word) => {
		const myWord = word.replace(ignoreRe, "").trim();
		if (!normalize(myWord).startsWith(normalizedText)) {
			return false;
		}
		const trailer = myWord.slice(normalizedText.length);
		// let result = "";
		// for (const token of trailer.split(/(\s+)/)) {
		// 	result += token;
		// 	if (token.replace(stripRe, "") !== "") {
		// 		break;
		// 	}
		// }
		const result = trailer;
		return normalize(result).replace(stripRe, "") ? result : false;
	}).filter(Boolean) as string[];
	let sortedTrailers = trailers;
	if (!isAlphabet) {
		const trailersSpaced: string[] = [];
		const trailersNospaced: string[] = [];
		trailers.forEach((trailer) => {
			(trailer[0] === " " ? trailersSpaced : trailersNospaced).push(trailer);
		});
		sortedTrailers = trailersNospaced.concat(trailersSpaced);
	}
	// logger.info(sortedTrailers);
	if (sortedTrailers.length <= index) {
		return null;
	}
	return sortedTrailers[index].replace(stripRe, "");
}

function slackDecode(text: string): string {
	let result = text.replace(/<([^>]+)>/g, (str, cont) => {
		const m = /.+\|(.+)/.exec(cont);
		if (m) {
			return m[1];
		}
		if (/^[@#!]/.test(cont)) {
			return "";
		}
		return cont;
	}).replace(/&(lt|gt|amp);/g, (str, m1) => ({
		lt: "<",
		gt: ">",
		amp: "&",
	} as {[key: string]: string})[m1]);
	result = emoji.emojify(result);
	result = result.replace(/^>\s*/mg, ""); // blockquote
	result = result.trim();
	return result;
}

function htmlEscape(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function normalize(text: string): string {
	return text
		.normalize("NFKC")
		.replace(/\ufe0f/g, "")
		.replace(/\u200d/g, " ")
		.replace(/\u301c/g, "~")
		.toLowerCase();
}

interface PockyState {
	quineSolutions: string[];
	longQuineSolutions: string[];
}

interface PockyGame {
	quiz: PockyQuiz;
	channel: string;
	thread: string;
	timer: NodeJS.Timeout;
}

const isNovember11 = () => (
	new Date().toLocaleString('en-US', {
		timeZone: 'Asia/Tokyo',
		month: 'numeric',
		day: 'numeric',
	}) === '11/11'
);

class PockyBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^ポッキーゲーム$/;

	protected override readonly username = 'pocky';

	protected override readonly iconEmoji = ':google:';

	private game: PockyGame | null = null;

	// 出題の生成中に重複してゲームが開始されるのを防ぐ
	private isGenerating = false;

	private readonly recentThemes: string[] = [];

	constructor(
		protected readonly slackClients: SlackInterface,
		private readonly state: PockyState,
	) {
		super(slackClients);
	}

	protected override onWakeWord(_message: GenericMessageEvent, channel: string): Promise<string | null> {
		const gameMessageDeferred = new Deferred<string | null>();

		(async () => {
			if (this.game !== null) {
				const {permalink} = await this.slack.chat.getPermalink({
					channel: this.game.channel,
					message_ts: this.game.thread,
				});
				await this.postMessage({
					channel,
					text: `<${permalink}|進行中のゲーム>があるよ:thinking_face:`,
					unfurl_links: false,
					unfurl_media: false,
				});
				gameMessageDeferred.resolve(null);
				return;
			}

			if (this.isGenerating) {
				gameMessageDeferred.resolve(null);
				return;
			}

			this.isGenerating = true;
			try {
				gameMessageDeferred.resolve(await this.startGame(channel));
			} finally {
				this.isGenerating = false;
			}
		})().catch((error: unknown) => {
			this.log.error('Failed to start pocky game', error);
			const errorText =
				error instanceof Error && error.stack !== undefined
					? error.stack : String(error);
			this.postMessage({
				channel,
				text: `エラー😢\n\`${errorText}\``,
			});
			gameMessageDeferred.resolve(null);
		});

		return gameMessageDeferred.promise;
	}

	private async startGame(channel: string): Promise<string | null> {
		const quiz = await generateQuiz(this.recentThemes);

		if (quiz === null) {
			await this.postMessage({
				channel,
				text: 'エラーΩ＼ζ°)ﾁｰﾝ',
			});
			return null;
		}

		this.recentThemes.push(quiz.theme.word);
		if (this.recentThemes.length > 50) {
			this.recentThemes.shift();
		}

		this.log.info(quiz.theme);

		const {ts: thread} = await this.postMessage({
			channel,
			text: stripIndents`
				ポッキーゲームを始めるよ～
				${quiz.maskedHints.join(' / ')}
			`,
		});

		await this.postMessage({
			channel,
			thread_ts: thread,
			text: stripIndents`
				下の単語の〇〇に共通して入る単語は何かな～？
				スレッドで回答してね!
				3分経過で答えを発表するよ～

				${quiz.maskedHints.map((hint) => `• ${hint}`).join('\n')}
			`,
		});

		const timer = setTimeout(() => {
			this.onTimeUp().catch((error: unknown) => {
				this.log.error('Failed to finish pocky game', error);
			});
		}, 3 * 60 * 1000);

		this.game = {quiz, channel, thread, timer};

		return thread;
	}

	private async onTimeUp() {
		const {game} = this;
		if (game === null) {
			return;
		}
		this.game = null;

		const {quiz: {theme}, channel, thread} = game;

		await this.postMessage({
			channel,
			thread_ts: thread,
			reply_broadcast: true,
			text: stripIndents`
				なんでわからないの？
				答えは＊${theme.word}＊ (${theme.ruby}) だよ:anger:
			`,
		});
		await this.postAnswerDetails(game);
		await this.deleteProgressMessage(thread);
	}

	private async onAnswer(message: GenericMessageEvent, game: PockyGame) {
		const {quiz: {theme}, channel, thread} = game;

		if (!isCorrectAnswer(message.text, theme)) {
			await this.slack.reactions.add({
				name: 'no_good',
				channel: message.channel,
				timestamp: message.ts,
			});
			return;
		}

		clearTimeout(game.timer);
		this.game = null;

		await this.postMessage({
			channel,
			thread_ts: thread,
			reply_broadcast: true,
			text: stripIndents`
				<@${message.user}> 正解:tada:
				答えは＊${theme.word}＊ (${theme.ruby}) だよ:tada:
			`,
		});
		await this.postAnswerDetails(game);
		await this.deleteProgressMessage(thread);

		increment(message.user, 'pockygame-win');
		if (isNovember11()) {
			unlock(message.user, 'pockygame-on-nov-11');
		}
	}

	private postAnswerDetails({quiz: {theme, hints}, channel, thread}: PockyGame) {
		const details = [
			`• 出題ソース: ${theme.sourceDescription}`,
			...(theme.aliases.length > 0 ? [`• 別解: ${theme.aliases.join(' / ')}`] : []),
			'',
			...hints.map((hint) => `• ${revealHint(hint, theme)}`),
		].join('\n');

		return this.postMessage({
			channel,
			thread_ts: thread,
			text: details,
		});
	}

	private async onPockyQuery(message: GenericMessageEvent) {
		const query = slackDecode(message.text.trim());
		const match = /([\s\S]+?)([？?]+)$/.exec(query);
		if (!match) {
			return;
		}

		const result = await reply(match[1], match[2].length - 1);
		if (result === null) {
			return;
		}

		await this.postMessage({
			channel: message.channel,
			text: htmlEscape(result),
			...(message.thread_ts ? {thread_ts: message.thread_ts} : {}),
		});

		unlock(message.user, 'pocky');
		getMemberName(message.user).then((value) => {
			if (value === result) {
				unlock(message.user, 'self-pocky');
			}
		}, (error: Error) => {
			this.log.error('error:', error.message);
		});
		if (Array.from(result).length >= 20) {
			unlock(message.user, 'long-pocky');
		}
		if (match[1] === result && !this.state.quineSolutions.includes(result)) {
			unlock(message.user, 'quine-pocky');
			this.state.quineSolutions.push(result);
		}
		if (Array.from(result).length >= 20 && match[1] === result && !this.state.longQuineSolutions.includes(result)) {
			unlock(message.user, 'long-quine-pocky');
			this.state.longQuineSolutions.push(result);
		}
		if (isNovember11()) {
			unlock(message.user, 'pocky-on-nov-11');
		}
	}

	protected override async onMessageEvent(event: MessageEvent) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);

		if (
			message === null ||
			!message.text ||
			!message.user ||
			!isGenericMessage(message)
		) {
			return;
		}

		const {game} = this;
		if (game !== null && message.channel === game.channel && message.thread_ts === game.thread) {
			await this.onAnswer(message, game);
			return;
		}

		// サジェスト機能はゲームではないため、従来どおり #sandbox でのみ動作させる
		if (message.channel === process.env.CHANNEL_SANDBOX && !this.wakeWordRegex.test(message.text)) {
			await this.onPockyQuery(message);
		}
	}
}

export default async (slackClients: SlackInterface) => {
	const state = await State.init<PockyState>('pocky', {
		quineSolutions: [],
		longQuineSolutions: [],
	});

	return new PockyBot(slackClients, state);
};
