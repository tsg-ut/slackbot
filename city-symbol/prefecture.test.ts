import {describe, it, expect, vi, beforeEach, type Mock} from 'vitest';
import type {AteQuizProblem} from '../atequiz';
import type {SlackInterface} from '../lib/slack';
import Slack from '../lib/slackMock';
import {
	PrefectureAteQuiz,
	PrefectureQuizBot,
	getPrefectureQuizState,
	extractJson,
	extractStringValue,
	resolveHintItem,
	parseHintsFromParsed,
	normalizeRawHints,
	formatPrefectureProgressMessage,
	type PrefectureHint,
	type PrefectureQuizState,
} from './prefecture';
import {prefectureMetaList} from './common';

vi.mock('../achievements');
vi.mock('../lib/state');
vi.mock('../lib/slack', () => ({
	__esModule: true,
	eventClient: {on: vi.fn()},
	getTokens: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/openai', () => ({
	__esModule: true,
	default: {},
}));

describe('PrefectureAteQuiz', () => {
	const createMockSlack = () => {
		const chat = {
			postMessage: vi.fn().mockResolvedValue({ts: '12345.6789', ok: true}),
		};
		const reactions = {
			add: vi.fn().mockResolvedValue({ok: true}),
		};
		const webClient = {
			chat,
			reactions,
		} as any;

		const eventClient = {
			on: vi.fn(),
		} as any;

		return {
			slackInterface: {
				webClient,
				eventClient,
				messageClient: {} as any,
			} as SlackInterface,
			chat,
			reactions,
		};
	};

	const createSampleProblem = (chosenPref = '滋賀県'): AteQuizProblem => {
		const meta = prefectureMetaList[chosenPref as keyof typeof prefectureMetaList];
		return {
			problemMessage: {
				channel: 'C_TEST',
				text: '問題文',
			},
			immediateMessage: {
				channel: 'C_TEST',
				text: 'ヒント1',
			},
			hintMessages: [
				{channel: 'C_TEST', text: 'ヒント2'},
				{channel: 'C_TEST', text: 'ヒント3'},
				{channel: 'C_TEST', text: 'ヒント4'},
				{channel: 'C_TEST', text: 'ヒント5'},
			],
			solvedMessage: {
				channel: 'C_TEST',
				text: '正解！',
			},
			unsolvedMessage: {
				channel: 'C_TEST',
				text: '時間切れ！',
			},
			correctAnswers: [
				chosenPref,
				chosenPref.slice(0, -1),
				meta.hiragana,
				meta.romaji,
			],
		};
	};

	it('returns correct wait seconds for each hint stage', () => {
		const {slackInterface} = createMockSlack();
		const problem = createSampleProblem();
		const quiz = new PrefectureAteQuiz(slackInterface, problem);

		// hintMessages は 4 つ (ヒント2, 3, 4, 5)
		expect(quiz.waitSecGen(0)).toBe(15);
		expect(quiz.waitSecGen(1)).toBe(15);
		expect(quiz.waitSecGen(2)).toBe(15);
		expect(quiz.waitSecGen(3)).toBe(15);
		// 最後のヒントの後は 30 秒
		expect(quiz.waitSecGen(4)).toBe(30);
	});

	it('judges correct and incorrect prefecture answers', () => {
		const {slackInterface} = createMockSlack();
		const problem = createSampleProblem('滋賀県');
		const quiz = new PrefectureAteQuiz(slackInterface, problem);

		// 不正解の都道府県
		expect(quiz.judge('京都府', 'U001')).toBe(false);

		// 同じヒント期間で再度回答しようとしても無効（回答権消費済み）
		expect(quiz.judge('滋賀県', 'U001')).toBe(false);

		// 別のユーザーは回答可能
		expect(quiz.judge('滋賀県', 'U002')).toBe(true);
	});

	it('ignores non-prefecture messages without consuming answer right', () => {
		const {slackInterface} = createMockSlack();
		const problem = createSampleProblem('滋賀県');
		const quiz = new PrefectureAteQuiz(slackInterface, problem);

		// 都道府県名ではないメッセージ
		expect(quiz.judge('うーん難しいな', 'U001')).toBe(false);

		// 回答権は消費されていないので、その後に都道府県を回答可能
		expect(quiz.judge('滋賀', 'U001')).toBe(true);
	});

	it('resets answer rights when a new hint message is posted to the thread', async () => {
		const {slackInterface, chat} = createMockSlack();
		const problem = createSampleProblem('滋賀県');
		const quiz = new PrefectureAteQuiz(slackInterface, problem);

		// ヒント1期間: U001 が不正解を回答
		expect(quiz.judge('京都', 'U001')).toBe(false);
		expect(quiz.judge('大阪', 'U001')).toBe(false); // 2回目は無効

		// 次のヒントがスレッドに投稿される
		await quiz.slack.chat.postMessage({
			channel: 'C_TEST',
			text: 'ヒント2',
			thread_ts: '12345.6789',
		});

		// 回答権がリセットされ、U001 は再び回答可能になる
		expect(quiz.judge('滋賀県', 'U001')).toBe(true);
	});

	it('invokes onHintDelivered callback when subsequent hints are posted', async () => {
		const {slackInterface} = createMockSlack();
		const problem = createSampleProblem('滋賀県');
		const onHintDelivered = vi.fn();
		const quiz = new PrefectureAteQuiz(slackInterface, problem, undefined, {onHintDelivered});

		expect(quiz.hintCount).toBe(1);

		// Post Hint 2 to thread
		await quiz.slack.chat.postMessage({
			channel: 'C_TEST',
			text: 'ヒント2',
			thread_ts: '12345.6789',
		});
		expect(quiz.hintCount).toBe(2);
		expect(onHintDelivered).toHaveBeenCalledWith(2);

		// Post Hint 3 to thread
		await quiz.slack.chat.postMessage({
			channel: 'C_TEST',
			text: 'ヒント3',
			thread_ts: '12345.6789',
		});
		expect(quiz.hintCount).toBe(3);
		expect(onHintDelivered).toHaveBeenCalledWith(3);
	});
});

describe('extractJson', () => {
	it('extracts JSON from standard json string', () => {
		const str = '{"hints": [{"type": "text", "text": "hello"}]}';
		expect(extractJson(str)).toEqual({hints: [{type: 'text', text: 'hello'}]});
	});

	it('extracts JSON from markdown code block', () => {
		const str = '以下が出題です：\n```json\n{"hints": [{"type": "text", "text": "hello"}]}\n```\nよろしくお願いします。';
		expect(extractJson(str)).toEqual({hints: [{type: 'text', text: 'hello'}]});
	});

	it('extracts only the first JSON object when text is followed by extra content', () => {
		const str = '{"hints": [{"type": "text", "text": "hello"}]}\n解説：この問題は{難問}です。';
		expect(extractJson(str)).toEqual({hints: [{type: 'text', text: 'hello'}]});
	});

	it('handles strings with nested braces and escapes', () => {
		const str = '{"hints": [{"type": "text", "text": "foo {bar} \\"baz\\""}]}';
		expect(extractJson(str)).toEqual({hints: [{type: 'text', text: 'foo {bar} "baz"'}]});
	});

	it('extracts JSON array directly', () => {
		const str = '[{"type": "text", "text": "hello"}]';
		expect(extractJson(str)).toEqual([{type: 'text', text: 'hello'}]);
	});
});

describe('resolveHintItem', () => {
	it('resolves standard text hint object', () => {
		const item = {type: 'text', text: '滋賀県には日本一の湖があります', explanation: '琵琶湖'};
		const resolved = resolveHintItem(item, '滋賀県');
		expect(resolved).toEqual({
			type: 'text',
			text: '〇〇には日本一の湖があります',
			explanation: '琵琶湖',
		});
	});

	it('resolves text hint with alternative key names (hint, explanation)', () => {
		const item = {hint: '愛媛県のみかんは有名です', explanation: '温州みかん'};
		const resolved = resolveHintItem(item, '愛媛県');
		expect(resolved).toEqual({
			type: 'text',
			text: '〇〇のみかんは有名です',
			explanation: '温州みかん',
		});
	});

	it('resolves text hint with Japanese keys (ヒント, 解説)', () => {
		const item = {ヒント: '京都府の金閣寺', 解説: '臨済宗相国寺派'};
		const resolved = resolveHintItem(item, '京都府');
		expect(resolved).toEqual({
			type: 'text',
			text: '〇〇の金閣寺',
			explanation: '臨済宗相国寺派',
		});
	});

	it('resolves plain string hint', () => {
		const str = '東京都には東京タワーがあります';
		const resolved = resolveHintItem(str, '東京都');
		expect(resolved).toEqual({
			type: 'text',
			text: '〇〇には〇〇タワーがあります',
			explanation: undefined,
		});
	});

	it('resolves nested text object', () => {
		const item = {text: {text: '大阪府のたこ焼き'}, explanation: '郷土料理'};
		const resolved = resolveHintItem(item, '大阪府');
		expect(resolved).toEqual({
			type: 'text',
			text: '〇〇のたこ焼き',
			explanation: '郷土料理',
		});
	});

	it('resolves numbered key in object', () => {
		const item = {'1': '奈良県の大仏', note: '東大寺'};
		const resolved = resolveHintItem(item, '奈良県');
		expect(resolved).toEqual({
			type: 'text',
			text: '〇〇の大仏',
			explanation: '東大寺',
		});
	});

	it('resolves image hint with file property', () => {
		const item = {type: 'image', file: 'Lake_Biwa.jpg', explanation: '琵琶湖'};
		const resolved = resolveHintItem(item, '滋賀県');
		expect(resolved).toEqual({
			type: 'image',
			file: 'Lake_Biwa.jpg',
			explanation: '琵琶湖',
		});
	});

	it('resolves image hint with image or filename property and File: prefix', () => {
		const item = {type: 'image', image: 'ファイル:Lake_Biwa.png', caption: '琵琶湖'};
		const resolved = resolveHintItem(item, '滋賀県');
		expect(resolved).toEqual({
			type: 'image',
			file: 'Lake_Biwa.png',
			explanation: '琵琶湖',
		});
	});

	it('never returns [object Object] as text', () => {
		const item = {type: 'text', text: '[object Object]'};
		expect(resolveHintItem(item, '滋賀県')).toBeNull();

		const emptyItem = {};
		expect(resolveHintItem(emptyItem, '滋賀県')).toBeNull();
	});

	it('normalizes "この県" or "当県" to "この都道府県" without duplicating "都道府県"', () => {
		const item1 = {type: 'text', text: 'この県には日本一の湖があります'};
		const resolved1 = resolveHintItem(item1, '滋賀県');
		expect(resolved1).toEqual({
			type: 'text',
			text: 'この都道府県には日本一の湖があります',
			explanation: undefined,
		});

		const item2 = {type: 'text', text: 'この都道府県には日本一の山があります'};
		const resolved2 = resolveHintItem(item2, '静岡県');
		expect(resolved2).toEqual({
			type: 'text',
			text: 'この都道府県には日本一の山があります',
			explanation: undefined,
		});

		const item3 = {type: 'text', text: '当県では伝統行事が行われています'};
		const resolved3 = resolveHintItem(item3, '青森県');
		expect(resolved3).toEqual({
			type: 'text',
			text: 'この都道府県では伝統行事が行われています',
			explanation: undefined,
		});
	});
});

describe('parseHintsFromParsed', () => {
	it('extracts from array directly', () => {
		const arr = [{text: 'a'}, {text: 'b'}];
		expect(parseHintsFromParsed(arr)).toEqual(arr);
	});

	it('extracts from hints property array', () => {
		const obj = {hints: [{text: 'a'}, {text: 'b'}]};
		expect(parseHintsFromParsed(obj)).toEqual([{text: 'a'}, {text: 'b'}]);
	});

	it('extracts from hints dictionary/object', () => {
		const obj = {hints: {'1': {text: 'a'}, '2': {text: 'b'}, '3': {text: 'c'}}};
		expect(parseHintsFromParsed(obj)).toEqual([{text: 'a'}, {text: 'b'}, {text: 'c'}]);
	});

	it('extracts from Japanese key ヒント', () => {
		const obj = {ヒント: [{text: 'a'}, {text: 'b'}]};
		expect(parseHintsFromParsed(obj)).toEqual([{text: 'a'}, {text: 'b'}]);
	});

	it('extracts from top-level dictionary with 3+ values', () => {
		const obj = {'1': {text: 'a'}, '2': {text: 'b'}, '3': {text: 'c'}};
		expect(parseHintsFromParsed(obj)).toEqual([{text: 'a'}, {text: 'b'}, {text: 'c'}]);
	});
});

describe('normalizeRawHints', () => {
	it('limits images to maximum 1 and converts surplus images to text if explanation exists', () => {
		const raw = [
			{type: 'text', text: 'ヒント1'},
			{type: 'image', file: 'img1.jpg', explanation: '画像1'},
			{type: 'image', file: 'img2.jpg', explanation: '画像2解説'},
			{type: 'text', text: 'ヒント4'},
			{type: 'text', text: 'ヒント5'},
		];
		const normalized = normalizeRawHints(raw, '滋賀県');
		expect(normalized).toHaveLength(5);
		expect(normalized[0].type).toBe('text');
		expect(normalized[1].type).toBe('image');
		expect(normalized[2].type).toBe('text'); // 2枚目はtextにフォールバック
		expect((normalized[2] as any).text).toBe('画像2解説');
		expect(normalized[3].type).toBe('text');
		expect(normalized[4].type).toBe('text');
	});

	it('filters out invalid or empty items and takes up to 5', () => {
		const raw = [
			{type: 'text', text: 'ヒント1'},
			null,
			{text: '[object Object]'},
			{type: 'text', text: 'ヒント2'},
			{type: 'text', text: 'ヒント3'},
			{type: 'text', text: 'ヒント4'},
			{type: 'text', text: 'ヒント5'},
			{type: 'text', text: 'ヒント6'},
		];
		const normalized = normalizeRawHints(raw, '滋賀県');
		expect(normalized).toHaveLength(5);
		expect(normalized.map((h) => (h as any).text)).toEqual([
			'ヒント1',
			'ヒント2',
			'ヒント3',
			'ヒント4',
			'ヒント5',
		]);
	});
});

describe('formatPrefectureProgressMessage', () => {
	const sampleHints: PrefectureHint[] = [
		{type: 'text', text: 'この都道府県はゲーム機の世帯保有率が全国1位です。'},
		{type: 'image', file: 'Lake_Yogo.jpg', explanation: '余呉湖'},
		{type: 'text', text: 'この都道府県では音楽フェスが毎年開催されます。'},
		{type: 'text', text: 'この都道府県には競技かるたの聖地が存在します。'},
		{type: 'text', text: 'この都道府県には日本最大の湖が存在します。'},
	];
	const gameUrl = 'https://slack.com/archives/C123/p456';

	it('formats only hint 1 when deliveredHintCount is 1', () => {
		const formatted = formatPrefectureProgressMessage(sampleHints, 1, gameUrl);
		expect(formatted).toBe([
			'この都道府県は何でしょう？',
			'* ヒント1: この都道府県はゲーム機の世帯保有率が全国1位です。',
			'',
			'回答は<https://slack.com/archives/C123/p456|こちら>から！',
		].join('\n'));
	});

	it('formats hints 1 to 2 with image displayed as [写真]', () => {
		const formatted = formatPrefectureProgressMessage(sampleHints, 2, gameUrl);
		expect(formatted).toBe([
			'この都道府県は何でしょう？',
			'* ヒント1: この都道府県はゲーム機の世帯保有率が全国1位です。',
			'* ヒント2: [写真]',
			'',
			'回答は<https://slack.com/archives/C123/p456|こちら>から！',
		].join('\n'));
	});

	it('formats all 5 hints when deliveredHintCount is 5', () => {
		const formatted = formatPrefectureProgressMessage(sampleHints, 5, gameUrl);
		expect(formatted).toBe([
			'この都道府県は何でしょう？',
			'* ヒント1: この都道府県はゲーム機の世帯保有率が全国1位です。',
			'* ヒント2: [写真]',
			'* ヒント3: この都道府県では音楽フェスが毎年開催されます。',
			'* ヒント4: この都道府県には競技かるたの聖地が存在します。',
			'* ヒント5: この都道府県には日本最大の湖が存在します。',
			'',
			'回答は<https://slack.com/archives/C123/p456|こちら>から！',
		].join('\n'));
	});

	it('caps hint count at actual hints length', () => {
		const formatted = formatPrefectureProgressMessage(sampleHints, 10, gameUrl);
		expect(formatted).toBe([
			'この都道府県は何でしょう？',
			'* ヒント1: この都道府県はゲーム機の世帯保有率が全国1位です。',
			'* ヒント2: [写真]',
			'* ヒント3: この都道府県では音楽フェスが毎年開催されます。',
			'* ヒント4: この都道府県には競技かるたの聖地が存在します。',
			'* ヒント5: この都道府県には日本最大の湖が存在します。',
			'',
			'回答は<https://slack.com/archives/C123/p456|こちら>から！',
		].join('\n'));
	});
});

describe('PrefectureQuizBot with Stock and ProgressMessage', () => {
	let slack: Slack;

	beforeEach(() => {
		slack = new Slack();
		process.env.CHANNEL_GAMES = slack.fakeChannel;
		process.env.CHANNEL_SANDBOX = 'C_SANDBOX';
		(slack.webClient.chat.getPermalink as Mock).mockResolvedValue({
			ok: true,
			permalink: 'https://slack.com/archives/CHANNEL_ID/p1234567890123456',
		});
		(slack.webClient.chat.postMessage as Mock).mockResolvedValue({
			ok: true,
			ts: 'progress.ts.100',
		});
		(slack.webClient.chat.update as Mock).mockResolvedValue({
			ok: true,
			ts: 'progress.ts.100',
		});
		(slack.webClient.chat.delete as Mock).mockResolvedValue({
			ok: true,
		});
	});

	it('uses stocked quiz immediately on wake word and formats initial progress message', async () => {
		const state = await getPrefectureQuizState();
		state.stockedQuiz = {
			prefecture: '滋賀県',
			hints: [
				{type: 'text', text: 'この都道府県はゲーム機の世帯保有率が全国1位です。'},
				{type: 'image', file: 'Lake_Yogo.jpg', explanation: '余呉湖'},
				{type: 'text', text: 'この都道府県では音楽フェスが毎年開催されます。'},
				{type: 'text', text: 'この都道府県には競技かるたの聖地が存在します。'},
				{type: 'text', text: 'この都道府県には日本最大の湖が存在します。'},
			],
			sources: [],
		};

		const bot = new PrefectureQuizBot(slack);
		vi.spyOn(bot, 'replenishStock').mockResolvedValue(null);

		slack.postMessage('都道府県当てクイズ', {channel: slack.fakeChannel});
		await new Promise(setImmediate);

		// Stock was consumed
		expect(state.stockedQuiz).toBeNull();
		// replenishStock was triggered in background
		expect(bot.replenishStock).toHaveBeenCalled();

		// Progress message posted to sandbox with Hint 1
		expect(slack.webClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
			channel: 'C_SANDBOX',
			text: expect.stringContaining('* ヒント1: この都道府県はゲーム機の世帯保有率が全国1位です。'),
		}));
	});
});

