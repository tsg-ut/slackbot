import type {Block, ChatPostMessageArguments, KnownBlock, MessageEvent} from '@slack/web-api';
import {AteQuiz, type AteQuizProblem, type AteQuizStartOption} from '../atequiz';
import type {SlackInterface} from '../lib/slack';
import {isValidPrefectureAnswer} from './answers';

function buildHintBlocks(revealedHints: string[]): (Block | KnownBlock)[] {
	return [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: ':japan: 都道府県当てクイズ！',
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: 'スレッドで回答してください。1人3回まで有効です。',
			},
		},
		{
			type: 'rich_text',
			elements: [
				{
					type: 'rich_text_section',
					elements: [{type: 'text', text: '現在公開中のヒント:'}],
				},
				{
					type: 'rich_text_list',
					style: 'ordered',
					indent: 0,
					border: 0,
					elements: revealedHints.map((hint) => ({
						type: 'rich_text_section',
						elements: [{type: 'text', text: hint}],
					})),
				},
			],
		},
	];
}

export class PrefectureAteQuiz extends AteQuiz {
	#answersCount: Map<string, number> = new Map();
	#problemMessageTs: string | null = null;
	#allHints: string[];
	#revealedCount: number;
	#channel: string;
	#lastMessage: MessageEvent | null = null;

	constructor(
		slack: SlackInterface,
		problem: AteQuizProblem,
		allHints: string[],
		postOption?: Partial<ChatPostMessageArguments>,
	) {
		super(slack, problem, postOption);
		this.#allHints = allHints;
		// Hint 1 is already in the problem message, so revealed count starts at 1
		this.#revealedCount = 1;
		this.#channel = problem.problemMessage.channel as string;
	}

	override async start(option?: AteQuizStartOption) {
		return super.start({
			...option,
			onStarted: (msg) => {
				this.#problemMessageTs = msg.ts ?? null;
				option?.onStarted?.(msg);
			},
		});
	}

	// Hint 2–5 arrive every 45 seconds; after all hints, wait 30 seconds
	override waitSecGen(hintIndex: number): number {
		return hintIndex < this.problem.hintMessages.length ? 45 : 30;
	}

	override async isValidAnswer(answer: string, user: string, message: MessageEvent): Promise<boolean> {
		if (!isValidPrefectureAnswer(answer)) return false;

		const count = this.#answersCount.get(user) ?? 0;
		if (count >= 3) {
			await this.slack.reactions.add({
				name: 'no_entry_sign',
				channel: message.channel,
				timestamp: message.ts,
			});
			return false;
		}

		this.#answersCount.set(user, count + 1);
		this.#lastMessage = message;
		return true;
	}

	override async onHintPosted(hintIndex: number, _thread_ts: string): Promise<void> {
		// hintIndex is 0-based index into hintMessages (which are hints 2–5)
		this.#revealedCount = hintIndex + 2;
		const revealed = this.#allHints.slice(0, this.#revealedCount);
		if (!this.#problemMessageTs) return;

		await this.slack.chat.update({
			channel: this.#channel,
			ts: this.#problemMessageTs,
			text: `都道府県当てクイズ: ${revealed.length}件のヒントが公開中`,
			blocks: buildHintBlocks(revealed),
		});
	}
}
