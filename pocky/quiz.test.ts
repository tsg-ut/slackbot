import {describe, it, expect, vi} from 'vitest';

vi.mock('../achievements');
vi.mock('../lib/slack');
vi.mock('../lib/slackUtils');
vi.mock('../lib/openai');

import type {ChatPostMessageArguments} from '@slack/web-api';
import Slack from '../lib/slackMock';
import {
	normalize,
	normalizeAnswer,
	isCorrectAnswer,
	maskHint,
	revealHint,
	validateAndBuildQuiz,
	PockyGameBot,
	PockyQuiz,
	PockyTheme,
} from './quiz';

describe('pocky/quiz', () => {
	describe('normalize', () => {
		it('normalizes NFKC and lowercases', () => {
			expect(normalize(' ｉＰｈｏｎｅ　')).toBe('iphone');
			expect(normalize('ポッキー')).toBe('ポッキー');
		});
	});

	describe('normalizeAnswer', () => {
		it('hiraganizes and strips symbols and whitespace', () => {
			expect(normalizeAnswer('iPhone')).toBe('iphone');
			expect(normalizeAnswer('アイフォン')).toBe('あいふぉん');
			expect(normalizeAnswer('あいふぉん')).toBe('あいふぉん');
			expect(normalizeAnswer('スマートフォン')).toBe('すまーとふぉん');
			expect(normalizeAnswer('草なぎ 剛')).toBe('草なぎ剛');
		});
	});

	describe('isCorrectAnswer', () => {
		const theme: PockyTheme = {
			word: 'iPhone',
			ruby: 'あいふぉん',
			aliases: ['アイフォン', 'アイホン', 'iphone'],
			source: 'llm',
			sourceDescription: 'AI生成 (gpt-6-luna)',
		};

		it('matches exact word', () => {
			expect(isCorrectAnswer('iPhone', theme)).toBe(true);
		});

		it('matches lowercase word', () => {
			expect(isCorrectAnswer('iphone', theme)).toBe(true);
		});

		it('matches ruby in hiragana', () => {
			expect(isCorrectAnswer('あいふぉん', theme)).toBe(true);
		});

		it('matches alias in katakana', () => {
			expect(isCorrectAnswer('アイフォン', theme)).toBe(true);
			expect(isCorrectAnswer('アイホン', theme)).toBe(true);
		});

		it('rejects incorrect answers', () => {
			expect(isCorrectAnswer('Android', theme)).toBe(false);
			expect(isCorrectAnswer('iPad', theme)).toBe(false);
			expect(isCorrectAnswer('', theme)).toBe(false);
		});

		it('handles compound words with aliases', () => {
			const smartphoneTheme: PockyTheme = {
				word: 'スマートフォン',
				ruby: 'すまーとふぉん',
				aliases: ['スマホ', 'すまほ'],
				source: 'wikipedia',
				sourceDescription: 'Wikipedia PVランキング',
			};

			expect(isCorrectAnswer('スマートフォン', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('すまーとふぉん', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('スマホ', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('すまほ', smartphoneTheme)).toBe(true);
			expect(isCorrectAnswer('ガラケー', smartphoneTheme)).toBe(false);
		});
	});

	describe('maskHint and revealHint', () => {
		const theme: PockyTheme = {
			word: 'iPhone',
			ruby: 'あいふぉん',
			aliases: ['アイフォン'],
			source: 'llm',
			sourceDescription: 'AI生成 (gpt-6-luna)',
		};

		it('masks hint case-insensitively', () => {
			expect(maskHint('iphone 16', theme)).toBe('〇〇 16');
			expect(maskHint('IPHONE ケース', theme)).toBe('〇〇 ケース');
		});

		it('masks aliases to prevent spoilers', () => {
			expect(maskHint('アイフォン 買取', theme)).toBe('〇〇 買取');
		});

		it('reveals hint preserving word', () => {
			expect(revealHint('iphone 16', theme)).toBe('＊iPhone＊ 16');
			expect(revealHint('IPHONE ケース', theme)).toBe('＊iPhone＊ ケース');
		});
	});

	describe('validateAndBuildQuiz', () => {
		const theme: PockyTheme = {
			word: 'ポッキー',
			ruby: 'ぽっきー',
			aliases: [],
			source: 'dictionary',
			sourceDescription: '辞書 (KanjiBox)',
		};

		it('filters noise and requires at least 5 hints', () => {
			const suggestions = [
				'ポッキー', // 単体除外
				'ポッキーとは', // ノイズ除外
				'ポッキー 意味', // ノイズ除外
				'ポッキーの日',
				'ポッキー 種類',
				'ポッキー 値段',
			];

			// 有効ヒントが3件しかないので null
			expect(validateAndBuildQuiz(theme, suggestions)).toBeNull();
		});

		it('builds quiz when enough valid hints exist', () => {
			const suggestions = [
				'ポッキー',
				'ポッキーの日',
				'ポッキー 種類',
				'ポッキー 値段',
				'ポッキー カロリー',
				'ポッキー 懸賞',
				'ポッキー レシピ',
			];

			const quiz = validateAndBuildQuiz(theme, suggestions);
			expect(quiz).not.toBeNull();
			expect(quiz?.hints.length).toBe(6);
			expect(quiz?.maskedHints[0]).toBe('〇〇の日');
		});
	});
});

describe('PockyGameBot', () => {
	const mockQuiz: PockyQuiz = {
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

	let slack: InstanceType<typeof Slack>;

	const startGame = async () => {
		const message = await slack.getResponseTo('ポッキーゲーム');
		await slack.waitForResponse();
		return message;
	};

	describe('in the games channel', () => {
		beforeEach(() => {
			slack = new Slack();
			process.env.CHANNEL_SANDBOX = 'CSANDBOX';
			process.env.CHANNEL_GAMES = slack.fakeChannel;
			new PockyGameBot(slack, {generateQuiz: async () => mockQuiz});
		});

		it('starts a game by "ポッキーゲーム"', async () => {
			const message = await startGame();

			expect('username' in message && message.username).toBe('pocky');
			expect(message.text).toContain('ポッキーゲームを始めるよ～');
			expect(message.text).toContain('〇〇 ケース');
			expect(message.text).not.toContain('iPhone');
		});

		it('accepts an alias answer in the thread', async () => {
			await startGame();

			const response = await slack.getResponseTo('アイフォン', {thread_ts: slack.fakeTimestamp, ts: '1234567890.999999'});
			expect(response.text).toContain('正解:tada:');
			expect(response.reply_broadcast).toBe(true);

			const details = await slack.waitForResponse();
			expect(details.text).toContain('出題ソース: AI生成 (gpt-6-luna)');
			expect(details.text).toContain('別解: アイフォン / スマホ');
		});

		it('reacts to a wrong answer in the thread', async () => {
			await startGame();

			const reactionPromise = slack.waitForReaction();
			slack.postMessage('Android', {thread_ts: slack.fakeTimestamp, ts: '1234567890.999999'});
			const reaction = await reactionPromise;

			expect(reaction.name).toBe('no_good');
		});
	});

	describe('from a non-game channel', () => {
		beforeEach(() => {
			slack = new Slack();
			process.env.CHANNEL_SANDBOX = slack.fakeChannel;
			process.env.CHANNEL_GAMES = 'CGAMES';
			new PockyGameBot(slack, {generateQuiz: async () => mockQuiz});
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
});
