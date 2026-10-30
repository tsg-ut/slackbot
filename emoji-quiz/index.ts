import type {ChatPostMessageArguments, GenericMessageEvent, MessageEvent} from '@slack/web-api';
import {EventEmitter} from 'node:events';
import {sample} from 'lodash';
import {AteQuiz} from '../atequiz';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {Deferred} from '../lib/utils';
import {getEmojis} from '../lib/slackUtils';
import type {SlackInterface} from '../lib/slack';
import {increment} from '../achievements';
import {prefixAchievements} from './achievements';

const timeLimitSeconds = 60;
const EASY_MAX_NAME_LENGTH = 10;
const PRIMARY_ICON = 'blob-thinking';
const SECONDARY_ICON = 'hugging_face';

export const getQuestions = (emoji: Record<string, string>, easy = false) => {
	const resolve = (name: string): string | null => {
		const visited = new Set<string>();
		let value = emoji[name];
		while (value?.startsWith('alias:')) {
			if (visited.has(value)) {
				return null;
			}
			visited.add(value);
			value = emoji[value.slice('alias:'.length)];
		}
		return value && /^https?:\/\//.exec(value) ? value : null;
	};
	const questions = new Map<string, string[]>();
	for (const name of Object.keys(emoji)) {
		const url = resolve(name);
		if (url) {
			const names = questions.get(url) ?? [];
			names.push(name);
			questions.set(url, names);
		}
	}
	return Array.from(questions, ([url, names]) => ({url, names}))
		.filter(({names}) => !easy || names.some((name) => (
			name.length > 0 && name.length <= EASY_MAX_NAME_LENGTH &&
			Array.from(name).every((character) => character.codePointAt(0) <= 0x7F)
		)));
};

class EmojiAteQuiz extends AteQuiz {
	override eventClient = new EventEmitter();
	solvedAt: number | null = null;
	solvedAnswer: string | null = null;

	override waitSecGen() {
		return timeLimitSeconds;
	}

	override judge(answer: string) {
		return this.problem.correctAnswers.includes(answer.trim());
	}

	override solvedMessageGen(message: MessageEvent): ChatPostMessageArguments {
		this.solvedAt = Date.now();
		const answer = 'text' in message ? message.text.trim() : '';
		this.solvedAnswer = answer;
		const user = 'user' in message ? message.user : '';
		return {
			...this.problem.solvedMessage,
			text: `<@${user}> 正解です。\n答えは *${answer}* :${answer}: です。`,
		};
	}
}

class EmojiQuizBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^\s*絵文字当てクイズ(?:\s*easy)?\s*$/;

	protected override readonly username = 'emoji-quiz';

	protected override iconEmoji = `:${SECONDARY_ICON}:`;

	protected override readonly progressMessageChannel: string | undefined = undefined;

	private running: Deferred<string | null> | null = null;

	private quiz: EmojiAteQuiz | null = null;

	protected override async onMessageEvent(event: MessageEvent) {
		try {
			if ('thread_ts' in event && event.thread_ts) {
				if (
					this.quiz && event.channel === this.quiz.problem.problemMessage.channel &&
					event.subtype === undefined && 'user' in event && event.user && event.text &&
					!('bot_id' in event && event.bot_id)
				) {
					this.quiz.eventClient.emit('message', event);
				}
				return;
			}
			await super.onMessageEvent(event);
		} catch (error) {
			this.log.error('Failed to handle emoji quiz message', {error});
		}
	}

	protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		if (this.running) {
			await this.running.promise;
			await this.postMessage({
				channel,
				text: 'クイズは進行中です。出題メッセージのスレッドで回答してください。',
			});
			return null;
		}
		const started = new Deferred<string | null>();
		this.running = started;
		void this.runQuiz(channel, message.text.trim().endsWith('easy'), started);
		return started.promise;
	}

	private async runQuiz(channel: string, easy: boolean, started: Deferred<string | null>) {
		let thread: string | null = null;
		let startedAt: number | null = null;
		this.iconEmoji = `:${SECONDARY_ICON}:`;
		try {
			const emoji = await getEmojis();
			this.iconEmoji = `:${emoji?.[PRIMARY_ICON] ? PRIMARY_ICON : SECONDARY_ICON}:`;
			const question = sample(getQuestions(emoji ?? {}, easy));
			if (!question) {
				await this.postMessage({
					channel,
					text: easy ? 'easyの条件に合う絵文字がありません。' : '出題できる絵文字がありません。',
				});
				return;
			}
			const mode = easy ? `(easy: ASCII文字のみ, ${EASY_MAX_NAME_LENGTH}文字以下)` : '';
			const prompt = `この絵文字の登録名は何でしょう?${mode}\nスレッドでコロンを含めずに回答してください。制限時間は${timeLimitSeconds}秒です。`;
			this.quiz = new EmojiAteQuiz(this.slackClients, {
				problemMessage: {
					channel,
					text: prompt,
					blocks: [
						{type: 'section', text: {type: 'plain_text', text: prompt}},
						{type: 'image', image_url: question.url, alt_text: '出題の絵文字'},
					],
				},
				hintMessages: [],
				correctAnswers: question.names,
				solvedMessage: {channel, text: ''},
				incorrectMessage: {channel, text: '不正解です。登録名をコロンなしで回答してください。'},
				unsolvedMessage: {channel, text: `時間切れです。\n答えは *${question.names.join(',')}* です。`},
			}, {
				username: this.username,
				icon_emoji: this.iconEmoji,
				unfurl_links: false,
				unfurl_media: false,
			});
			const result = await this.quiz.start({
				mode: 'normal',
				onStarted: (response) => {
					if (!response.ts) {
						throw new Error('Slack did not return a message timestamp');
					}
					thread = response.ts;
					startedAt = Date.now();
					void started.resolve(thread);
				},
			});
			if (result.state === 'solved' && result.correctAnswerer) {
				await this.recordAchievements(result.correctAnswerer, easy, this.quiz, startedAt);
			}
		} catch (error) {
			this.log.error('Failed to start emoji quiz', {error});
			try {
				await this.postMessage({channel, text: 'クイズを開始できませんでした。時間をおいて再度試してください。'});
			} catch (postError) {
				this.log.error('Failed to post emoji quiz error', {error: postError});
			}
		} finally {
			this.quiz?.eventClient.removeAllListeners();
			this.quiz = null;
			this.running = null;
			if (thread) {
				this.progressMessages.delete(thread);
			}
			if (!started.isResolved) {
				void started.resolve(null);
			}
		}
	}

	private async recordAchievements(user: string, easy: boolean, quiz: EmojiAteQuiz, startedAt: number | null): Promise<void> {
		const counters = [
			'emoji-quiz-answer',
			easy ? 'emoji-quiz-easy-answer' : 'emoji-quiz-normal-answer',
			...prefixAchievements
				.filter(({prefix}) => quiz.solvedAnswer?.startsWith(prefix))
				.map(({counter}) => counter),
		];
		if (startedAt !== null && quiz.solvedAt !== null && quiz.solvedAt - startedAt <= 5000) {
			counters.push('emoji-quiz-answer-within-5s');
		}
		try {
			await Promise.all(counters.map((counter) => increment(user, counter)));
		} catch (error) {
			this.log.error('Failed to record emoji quiz achievements', {error});
		}
	}
}

const emojiQuiz = (slackClients: SlackInterface) => new EmojiQuizBot(slackClients);

export default emojiQuiz;
