import SlackMock from '../lib/slackMock';
import {getEmojis} from '../lib/slackUtils';
import emojiQuiz, {getQuestions} from './index';
import {increment} from '../achievements';

vi.mock('../lib/logger', () => ({default: {child: () => ({error: vi.fn(), info: vi.fn(), debug: vi.fn()})}}));
vi.mock('../lib/slackUtils');
vi.mock('../achievements', () => ({increment: vi.fn()}));

describe('emoji-quiz', () => {
	let slack: SlackMock;
	const send = async (text: string, options = {}) => {
		const message = {
			type: 'message', channel: slack.fakeChannel, user: slack.fakeUser,
			ts: '1234567891.000000', text, ...options,
		};
		await Promise.all(slack.eventClient.listeners('message').map((listener) => listener(message)));
		await new Promise(setImmediate);
	};
	const posts = () => vi.mocked(slack.webClient.chat.postMessage).mock.calls.map(([post]) => post);

	beforeEach(() => {
		vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
		vi.resetAllMocks();
		slack = new SlackMock();
		vi.stubEnv('CHANNEL_GAMES', slack.fakeChannel);
		vi.stubEnv('CHANNEL_SANDBOX', 'SANDBOX');
		vi.mocked(slack.webClient.emoji.list).mockResolvedValue({ok: true, emoji: {}});
		vi.mocked(getEmojis).mockResolvedValue({
			test_emoji: 'https://slack.example/test_emoji.png', alternate: 'alias:test_emoji',
		});
		vi.mocked(slack.webClient.chat.postMessage).mockResolvedValue({ok: true, ts: slack.fakeTimestamp});
		vi.mocked(slack.webClient.reactions.add).mockResolvedValue({ok: true});
		emojiQuiz(slack);
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('counts easy and normal wins separately and combines them in the total', async () => {
		await send('絵文字当てクイズ easy');
		await send('test_emoji', {thread_ts: slack.fakeTimestamp, user: 'UWINNER'});
		await send('絵文字当てクイズ');
		await send('alternate', {thread_ts: slack.fakeTimestamp, user: 'UWINNER'});
		const counters = vi.mocked(increment).mock.calls
			.filter(([user]) => user === 'UWINNER').map(([, counter]) => counter);
		expect(counters.filter((counter) => counter === 'emoji-quiz-answer')).toHaveLength(2);
		expect(counters.filter((counter) => counter === 'emoji-quiz-easy-answer')).toHaveLength(1);
		expect(counters.filter((counter) => counter === 'emoji-quiz-normal-answer')).toHaveLength(1);
	});

	it.each([
		['sushi-', 'emoji-quiz-answer-sushi'],
		['robot-', 'emoji-quiz-answer-robot'],
		['taiko-', 'emoji-quiz-answer-taiko'],
	])('counts %s achievements only when the submitted answer has the prefix', async (prefix, counter) => {
		vi.mocked(getEmojis).mockResolvedValueOnce({
			[`${prefix}original`]: 'https://example/image.png',
			[`${prefix}other`]: `alias:${prefix}original`,
			short: `alias:${prefix}other`,
		});
		await send('絵文字当てクイズ easy');
		await send('short', {thread_ts: slack.fakeTimestamp});
		expect(increment).not.toHaveBeenCalledWith(slack.fakeUser, counter);
		vi.mocked(getEmojis).mockResolvedValueOnce({
			[`${prefix}original`]: 'https://example/image.png',
			[`${prefix}other`]: `alias:${prefix}original`,
		});
		await send('絵文字当てクイズ');
		await send(` ${prefix}other `, {thread_ts: slack.fakeTimestamp});
		expect(vi.mocked(increment).mock.calls.filter(([, name]) => name === counter))
			.toEqual([[slack.fakeUser, counter]]);
	});

	it('does not award prefix achievements for names that merely contain a prefix', async () => {
		vi.mocked(getEmojis).mockResolvedValueOnce({
			'my-sushi-robot-taiko-': 'https://example/image.png',
		});
		await send('絵文字当てクイズ');
		await send('my-sushi-robot-taiko-', {thread_ts: slack.fakeTimestamp});
		for (const suffix of ['sushi', 'robot', 'taiko']) {
			expect(increment).not.toHaveBeenCalledWith(slack.fakeUser, `emoji-quiz-answer-${suffix}`);
		}
	});

	it.each([4999, 5000, 5001])('awards fast answers only within five seconds (%i ms)', async (elapsed) => {
		await send('絵文字当てクイズ');
		await vi.advanceTimersByTimeAsync(elapsed);
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		const fastCalls = vi.mocked(increment).mock.calls.filter(([, counter]) => counter === 'emoji-quiz-answer-within-5s');
		expect(fastCalls).toHaveLength(elapsed <= 5000 ? 1 : 0);
	});

	it('does not count startup delays or result posting delays as answering time', async () => {
		vi.mocked(getEmojis).mockImplementationOnce(async () => {
			vi.setSystemTime(Date.now() + 10_000);
			return {test_emoji: 'https://example/image.png'};
		});
		await send('絵文字当てクイズ');
		await vi.advanceTimersByTimeAsync(5000);
		vi.mocked(slack.webClient.chat.postMessage).mockImplementationOnce(async () => {
			vi.setSystemTime(Date.now() + 10_000);
			return {ok: true, ts: slack.fakeTimestamp};
		});
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		expect(increment).toHaveBeenCalledWith(slack.fakeUser, 'emoji-quiz-answer-within-5s');
	});

	it('does not count wrong answers, timeout or repeated answers as wins', async () => {
		await send('絵文字当てクイズ');
		await send('wrong', {thread_ts: slack.fakeTimestamp});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(increment).not.toHaveBeenCalled();
		await send('絵文字当てクイズ');
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		expect(vi.mocked(increment).mock.calls.filter(([, counter]) => counter === 'emoji-quiz-answer')).toHaveLength(1);
	});

	it('can start another quiz when achievement recording fails', async () => {
		vi.mocked(increment).mockRejectedValueOnce(new Error('achievement failure'));
		await send('絵文字当てクイズ');
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1).text).toContain('正解です。');
		await send('絵文字当てクイズ');
		expect(posts().at(-1)).toHaveProperty('blocks');
	});

	it('resolves aliases, groups identical images and excludes broken or cyclic aliases', () => {
		expect(getQuestions({
			original: 'https://example/image.png', alias: 'alias:original', chain: 'alias:alias',
			duplicate: 'https://example/image.png', broken: 'alias:missing',
			cycle: 'alias:cycle2', cycle2: 'alias:cycle',
		})).toEqual([{url: 'https://example/image.png', names: ['original', 'alias', 'chain', 'duplicate']}]);
	});

	it('filters easy questions by ASCII names of at most ten characters, including aliases', () => {
		const emoji = {
			abc_123456: 'https://example/ten.png',
			abcdefghijk: 'https://example/eleven.png',
			日本語: 'https://example/japanese.png',
			abcあ: 'https://example/mixed.png',
			long_original: 'https://example/alias.png',
			short: 'alias:long_original',
			'': 'https://example/empty.png',
		};
		expect(getQuestions(emoji, true)).toEqual([
			{url: 'https://example/ten.png', names: ['abc_123456']},
			{url: 'https://example/alias.png', names: ['long_original', 'short']},
		]);
		expect(getQuestions(emoji)).toHaveLength(6);
	});

	it.each(['絵文字当てクイズeasy', '絵文字当てクイズ easy'])('starts easy mode with %s', async (command) => {
		vi.mocked(getEmojis).mockResolvedValueOnce({
			abc_123456: 'https://example/ten.png',
			abcdefghijk: 'https://example/eleven.png',
			日本語: 'https://example/japanese.png',
		});
		await send(command);
		expect(posts()[0]).toMatchObject({blocks: [
			{type: 'section'}, {type: 'image', image_url: 'https://example/ten.png'},
		]});
		expect(posts()[0]).toMatchObject({text: expect.stringContaining('(easy: ASCII文字のみ, 10文字以下)')});
		await send('abc_123456', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1).text).toContain('正解です。');
	});

	it('can start a normal quiz after no emoji matches easy mode', async () => {
		vi.mocked(getEmojis).mockResolvedValueOnce({
			long_emoji_name: 'https://example/long.png',
		});
		await send('絵文字当てクイズeasy');
		expect(posts()[0]).toMatchObject({text: 'easyの条件に合う絵文字がありません。'});
		await send('絵文字当てクイズ');
		expect(posts().at(-1)).toHaveProperty('blocks');
	});

	it('uses the original image URL with neutral alt text', async () => {
		await send('絵文字当てクイズ');
		expect(posts()[0]).toMatchObject({blocks: [
			{type: 'section'},
			{type: 'image', image_url: 'https://slack.example/test_emoji.png', alt_text: '出題の絵文字'},
		]});
		expect(posts()[0].text).not.toContain('test_emoji');
	});

	it('accepts plain names only, allows retries, and stops after a correct answer', async () => {
		await send('絵文字当てクイズ');
		await send(':test_emoji:', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1).text).toBe('不正解です。登録名をコロンなしで回答してください。');
		await send('wrong', {thread_ts: slack.fakeTimestamp});
		await send(' test_emoji ', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1)).toMatchObject({thread_ts: slack.fakeTimestamp, text: '<@U00000000> 正解です。\n答えは *test_emoji* :test_emoji: です。'});
		const count = posts().length;
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(posts()).toHaveLength(count);
		await send('絵文字当てクイズ');
		expect(posts()).toHaveLength(count + 1);
	});

	it('accepts an alias as a correct answer', async () => {
		await send('絵文字当てクイズ');
		await send('alternate', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1).text).toContain('正解です。\n答えは *alternate* :alternate: です。');
	});

	it('runs in CHANNEL_GAMES and routes invocations from other channels there', async () => {
		const ephemeral = vi.mocked(slack.webClient.chat.postEphemeral).mockResolvedValue({ok: true});
		const remove = vi.mocked(slack.webClient.chat.delete).mockResolvedValue({ok: true});
		await send('絵文字当てクイズ', {channel: 'SANDBOX'});
		expect(posts()).toHaveLength(1);
		expect(posts()[0]).toMatchObject({channel: process.env.CHANNEL_GAMES});
		expect(ephemeral).toHaveBeenCalledWith(expect.objectContaining({
			channel: 'SANDBOX', user: slack.fakeUser, text: expect.stringContaining('こちら>で実行しました。'),
		}));
		expect(remove).toHaveBeenCalledWith(expect.objectContaining({channel: 'SANDBOX', ts: '1234567891.000000'}));
		await send('test_emoji', {channel: 'SANDBOX', thread_ts: slack.fakeTimestamp});
		expect(posts()).toHaveLength(1);
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1)).toMatchObject({channel: process.env.CHANNEL_GAMES, text: expect.stringContaining('正解です。')});
	});

	it('broadcasts results to the channel and keeps incorrect answers in the thread', async () => {
		await send('絵文字当てクイズ');
		await send('wrong', {thread_ts: slack.fakeTimestamp});
		await send('alternate', {thread_ts: slack.fakeTimestamp});
		expect(posts()).toHaveLength(3);
		expect(posts()[1]).toMatchObject({thread_ts: slack.fakeTimestamp});
		expect(posts()[1].reply_broadcast).not.toBe(true);
		expect(posts()[2]).toMatchObject({thread_ts: slack.fakeTimestamp, reply_broadcast: true});
		expect(slack.webClient.reactions.add).toHaveBeenCalledExactlyOnceWith({
			name: 'no_good', channel: slack.fakeChannel, timestamp: '1234567891.000000',
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not accumulate message listeners after completed quizzes or startup failures', async () => {
		const initialListeners = slack.eventClient.listenerCount('message');
		await send('絵文字当てクイズ');
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		expect(slack.eventClient.listenerCount('message')).toBe(initialListeners);
		await send('絵文字当てクイズ');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(slack.eventClient.listenerCount('message')).toBe(initialListeners);
		vi.mocked(slack.webClient.chat.postMessage).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(slack.eventClient.listenerCount('message')).toBe(initialListeners);
		expect(vi.getTimerCount()).toBe(0);
		await send('絵文字当てクイズ');
		expect(posts().at(-1)).toHaveProperty('blocks');
	});

	it('ignores other threads, bot messages, message edits and answers in other channels', async () => {
		await send('絵文字当てクイズ', {thread_ts: 'OTHER'});
		await send('絵文字当てクイズ', {bot_id: 'BOT'});
		await send('絵文字当てクイズ', {subtype: 'bot_message'});
		expect(posts()).toHaveLength(0);
		await send('絵文字当てクイズ');
		await send('test_emoji');
		await send('test_emoji', {thread_ts: 'OTHER'});
		await send('test_emoji', {thread_ts: slack.fakeTimestamp, channel: 'OTHER'});
		await send('test_emoji', {thread_ts: slack.fakeTimestamp, bot_id: 'BOT'});
		await send('', {subtype: 'message_changed', message: {text: 'test_emoji'}});
		expect(posts()).toHaveLength(1);
	});

	it('posts no hints and reveals the answer only after 60 seconds', async () => {
		await send('絵文字当てクイズ');
		expect(posts()[0]).toMatchObject({text: expect.stringContaining('制限時間は60秒です。')});
		await vi.advanceTimersByTimeAsync(59_999);
		expect(posts()).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(posts().at(-1)).toMatchObject({thread_ts: slack.fakeTimestamp, reply_broadcast: true, text: '時間切れです。\n答えは *test_emoji,alternate* です。'});
		await send('絵文字当てクイズ');
		expect(posts()).toHaveLength(3);
	});

	it('prevents overlapping quizzes during startup', async () => {
		await Promise.all([send('絵文字当てクイズ'), send('絵文字当てクイズ')]);
		expect(getEmojis).toHaveBeenCalledTimes(1);
		expect(slack.webClient.emoji.list).not.toHaveBeenCalled();
		expect(posts().at(-1).text).toContain('クイズは進行中です。');
	});

	it('handles an empty emoji list', async () => {
		vi.mocked(getEmojis).mockResolvedValueOnce({});
		await send('絵文字当てクイズ');
		expect(posts().at(-1).text).toBe('出題できる絵文字がありません。');
	});

	it.each([true, false])('uses the expected icon on every quiz message (blob-thinking registered: %s)', async (registered) => {
		vi.mocked(getEmojis).mockResolvedValue({
			test_emoji: 'https://slack.example/test_emoji.png',
			...(registered ? {'blob-thinking': 'alias:test_emoji'} : {}),
		});
		await send('絵文字当てクイズ');
		await send('絵文字当てクイズ');
		await send('wrong', {thread_ts: slack.fakeTimestamp});
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		await send('絵文字当てクイズ');
		await vi.advanceTimersByTimeAsync(60_000);
		vi.mocked(slack.webClient.chat.postMessage).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(posts()).toHaveLength(8);
		for (const post of posts()) {
			expect(post).toMatchObject({icon_emoji: registered ? ':blob-thinking:' : ':hugging_face:'});
		}
	});

	it('uses the fallback icon when the emoji list cannot be loaded', async () => {
		vi.mocked(getEmojis).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(posts()[0]).toMatchObject({icon_emoji: ':hugging_face:'});
	});

	it.each(['list', 'post'])('can retry after a %s failure', async (stage) => {
		if (stage === 'list') vi.mocked(getEmojis).mockRejectedValueOnce(new Error('failed'));
		if (stage === 'post') vi.mocked(slack.webClient.chat.postMessage).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(posts().at(-1).text).toContain('クイズを開始できませんでした。');
		await send('絵文字当てクイズ');
		expect(posts().at(-1)).toHaveProperty('blocks');
	});
});
