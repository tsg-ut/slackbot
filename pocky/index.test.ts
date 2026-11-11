import axios from 'axios';
import type {ChatPostMessageArguments} from '@slack/web-api';
import pocky from './index.js';
import Slack from '../lib/slackMock';
import * as quizModule from './quiz';

vi.mock('axios');
vi.mock('download');
vi.mock('../achievements');
vi.mock('../lib/slack');
vi.mock('../lib/slackUtils');
vi.mock('../lib/state');
vi.mock('../lib/openai');

const mockedAxios = axios as unknown as {response: unknown};

let slack: InstanceType<typeof Slack> = null;

const mockQuizGeneration = () => {
	vi.spyOn(quizModule, 'generateQuiz').mockResolvedValue({
		theme: {
			word: '猫',
			ruby: 'ねこ',
			aliases: [],
			source: 'dictionary',
			sourceDescription: '辞書',
		},
		hints: ['猫 かわいい', '猫 画像', '猫 動画', '猫 種類', '猫 寿命'],
		maskedHints: ['〇〇 かわいい', '〇〇 画像', '〇〇 動画', '〇〇 種類', '〇〇 寿命'],
	});
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('pocky', () => {
	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		process.env.CHANNEL_GAMES = slack.fakeChannel;
		await pocky(slack);
	});

	it('responds to "ほげ?"', async () => {
		mockedAxios.response = {data: [null, ['ほげ ふが']]};
		const message = await slack.getResponseTo('ほげ?');

		expect('username' in message && message.username).toBe('pocky');
		expect(message.text).toBe('ふが');
	});

	it('starts pockygame and accepts alias answer', async () => {
		const postedMessages: any[] = [];
		slack.on('chat.postMessage', (args) => {
			postedMessages.push(args);
		});

		const mockQuiz: quizModule.PockyQuiz = {
			theme: {
				word: 'iPhone',
				ruby: 'あいふぉん',
				aliases: ['アイフォン', 'スマホ'],
				source: 'llm',
				sourceDescription: 'AI生成 (gpt-6-luna)',
			},
			hints: ['iPhone 16', 'iPhone ケース', 'iPhone 値段', 'iPhone 買取', 'iPhone バッテリー'],
			maskedHints: ['〇〇 16', '〇〇 ケース', '〇〇 値段', '〇〇 買取', '〇〇 バッテリー'],
		};

		vi.spyOn(quizModule, 'generateQuiz').mockResolvedValue(mockQuiz);

		// ゲーム開始
		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'ポッキーゲーム',
			ts: '12344',
			user: 'U12345',
		});

		// スレッド開始メッセージ（2通目）が届くまで待機
		await new Promise<void>((resolve) => {
			const check = () => {
				if (postedMessages.length >= 2) {
					resolve();
				} else {
					setTimeout(check, 10);
				}
			};
			check();
		});

		// 出題メッセージが投稿されているか確認
		expect(postedMessages.some((msg) => msg.text.includes('ポッキーゲームを始めるよ～'))).toBe(true);

		// 正解（別解「アイフォン」で回答）
		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'アイフォン',
			thread_ts: slack.fakeTimestamp,
			ts: '12346',
			user: 'U12345',
		});

		// 正解詳細メッセージ（3通目）が届くまで待機
		await new Promise<void>((resolve) => {
			const check = () => {
				if (postedMessages.length >= 4) {
					resolve();
				} else {
					setTimeout(check, 10);
				}
			};
			check();
		});

		// 正解メッセージと詳細情報が投稿されていることを確認
		expect(postedMessages.some((msg) => msg.text.includes('正解:tada:'))).toBe(true);
		expect(postedMessages.some((msg) => msg.text.includes('出題ソース: AI生成 (gpt-6-luna)'))).toBe(true);
		expect(postedMessages.some((msg) => msg.text.includes('別解: アイフォン / スマホ'))).toBe(true);
	});
});

describe('pockygame', () => {
	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = 'CSANDBOX';
		process.env.CHANNEL_GAMES = slack.fakeChannel;
		mockQuizGeneration();
		await pocky(slack);
	});

	it('starts a game by "ポッキーゲーム"', async () => {
		const message = await slack.getResponseTo('ポッキーゲーム');

		expect('username' in message && message.username).toBe('pocky');
		expect(message.text).toContain('ポッキーゲームを始めるよ～');
		expect(message.text).toContain('〇〇 かわいい');
		expect(message.text).not.toContain('猫');
	});

	it('accepts the correct answer in the thread', async () => {
		await slack.getResponseTo('ポッキーゲーム');
		const hintMessage = await slack.waitForResponse();
		expect(hintMessage.thread_ts).toBe(slack.fakeTimestamp);

		const response = await slack.getResponseTo('ねこ', {thread_ts: slack.fakeTimestamp, ts: '1234567890.999999'});

		expect(response.text).toContain('正解');
		expect(response.text).toContain('猫');
		expect(response.reply_broadcast).toBe(true);
	});

	it('reacts to a wrong answer in the thread', async () => {
		await slack.getResponseTo('ポッキーゲーム');
		await slack.waitForResponse();

		const reactionPromise = slack.waitForReaction();
		slack.postMessage('犬', {thread_ts: slack.fakeTimestamp, ts: '1234567890.999999'});
		const reaction = await reactionPromise;

		expect(reaction.name).toBe('no_good');
	});
});

describe('pockygame from a non-game channel', () => {
	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		process.env.CHANNEL_GAMES = 'CGAMES';
		mockQuizGeneration();
		await pocky(slack);
	});

	it('starts the game in the games channel instead', async () => {
		const gameMessagePromise = new Promise<ChatPostMessageArguments>((resolve) => {
			slack.on('chat.postMessage', (options: ChatPostMessageArguments) => {
				if (options.channel === 'CGAMES' && options.thread_ts === undefined) {
					resolve(options);
				}
			});
		});
		const ephemeralPromise = slack.waitForEvent('chat.postEphemeral') as Promise<{text: string}>;

		slack.postMessage('ポッキーゲーム');

		const gameMessage = await gameMessagePromise;
		expect(gameMessage.text).toContain('ポッキーゲームを始めるよ～');

		const ephemeral = await ephemeralPromise;
		expect(ephemeral.text).toContain('このチャンネルではBOTを実行できません。');
	});
});
