import axios from 'axios';
import {v2 as cloudinary, type UploadApiResponse} from 'cloudinary';
import sharp from 'sharp';
import SlackMock from '../lib/slackMock';
import emojiQuiz, {getQuestions} from './index';

vi.mock('axios', () => ({default: {get: vi.fn()}}));
vi.mock('cloudinary', () => ({v2: {uploader: {upload_stream: vi.fn()}}}));
vi.mock('sharp', () => ({default: vi.fn()}));
vi.mock('../lib/logger', () => ({default: {child: () => ({error: vi.fn()})}}));

describe('emoji-quiz', () => {
	let slack: SlackMock;
	const image = Buffer.from('enlarged image');
	const resize = vi.fn();
	const send = async (text: string, options = {}) => {
		const message = {
			type: 'message', channel: slack.fakeChannel, user: slack.fakeUser,
			ts: '1234567891.000000', text, ...options,
		};
		await Promise.all(slack.eventClient.listeners('message').map((listener) => listener(message)));
	};
	const posts = () => vi.mocked(slack.webClient.chat.postMessage).mock.calls.map(([post]) => post);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetAllMocks();
		slack = new SlackMock();
		vi.stubEnv('CHANNEL_SANDBOX', slack.fakeChannel);
		vi.mocked(slack.webClient.emoji.list).mockResolvedValue({
			ok: true, emoji: {test_emoji: 'https://slack.example/test_emoji.png', alternate: 'alias:test_emoji'},
		});
		vi.mocked(slack.webClient.chat.postMessage).mockResolvedValue({ok: true, ts: slack.fakeTimestamp});
		vi.mocked(axios.get).mockResolvedValue({data: Buffer.from('source image')});
		vi.mocked(sharp).mockReturnValue({resize} as unknown as sharp.Sharp);
		resize.mockReturnValue({toBuffer: vi.fn().mockResolvedValue(image)});
		vi.mocked(cloudinary.uploader.upload_stream).mockImplementation((callback) => {
			const stream = {end: vi.fn(() => callback(undefined, {secure_url: 'https://cloudinary.example/random.png'} as UploadApiResponse))};
			return stream as unknown as ReturnType<typeof cloudinary.uploader.upload_stream>;
		});
		emojiQuiz(slack);
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllEnvs();
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
		vi.mocked(slack.webClient.emoji.list).mockResolvedValueOnce({
			ok: true,
			emoji: {
				abc_123456: 'https://example/ten.png',
				abcdefghijk: 'https://example/eleven.png',
				日本語: 'https://example/japanese.png',
			},
		});
		await send(command);
		expect(axios.get).toHaveBeenCalledWith('https://example/ten.png', expect.any(Object));
		expect(posts()[0]).toMatchObject({text: expect.stringContaining('easy：ASCII文字のみ・10文字以下')});
		await send('abc_123456', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1).text).toContain('正解です。');
	});

	it('can start a normal quiz after no emoji matches easy mode', async () => {
		vi.mocked(slack.webClient.emoji.list).mockResolvedValueOnce({
			ok: true, emoji: {long_emoji_name: 'https://example/long.png'},
		});
		await send('絵文字当てクイズeasy');
		expect(posts()[0]).toMatchObject({text: 'easyの条件に合う絵文字がありません。'});
		expect(axios.get).not.toHaveBeenCalled();
		await send('絵文字当てクイズ');
		expect(posts().at(-1)).toHaveProperty('blocks');
	});

	it('enlarges and rehosts the image without revealing the name in the question', async () => {
		await send('絵文字当てクイズ');
		expect(axios.get).toHaveBeenCalledWith('https://slack.example/test_emoji.png', expect.any(Object));
		expect(sharp).toHaveBeenCalledWith(Buffer.from('source image'), {animated: true});
		expect(resize).toHaveBeenCalledWith(512, 512, {fit: 'inside'});
		expect(posts()[0]).toMatchObject({blocks: [
			{type: 'section'},
			{type: 'image', image_url: 'https://cloudinary.example/random.png', alt_text: '出題の絵文字'},
		]});
		expect(JSON.stringify(posts()[0])).not.toContain('test_emoji');
	});

	it('accepts plain names only, allows retries, and stops after a correct answer', async () => {
		await send('絵文字当てクイズ');
		await send(':test_emoji:', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1).text).toBe('不正解です。登録名をコロンなしで回答してください。');
		await send('wrong', {thread_ts: slack.fakeTimestamp});
		await send(' test_emoji ', {thread_ts: slack.fakeTimestamp});
		expect(posts().at(-1)).toMatchObject({thread_ts: slack.fakeTimestamp, text: '<@U00000000> 正解です。答えは test_emoji :test_emoji: です。'});
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
		expect(posts().at(-1).text).toContain('正解です。答えは alternate :alternate: です。');
	});

	it('ignores other channels, threads, bot messages and message edits', async () => {
		await send('絵文字当てクイズ', {channel: 'OTHER'});
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
		expect(posts().at(-1)).toMatchObject({thread_ts: slack.fakeTimestamp, text: '時間切れです。答えは test_emoji,alternate です。'});
		await send('絵文字当てクイズ');
		expect(posts()).toHaveLength(3);
	});

	it('prevents overlapping quizzes even while preparing an image', async () => {
		await Promise.all([send('絵文字当てクイズ'), send('絵文字当てクイズ')]);
		expect(slack.webClient.emoji.list).toHaveBeenCalledTimes(1);
		expect(posts().at(-1).text).toContain('クイズは進行中です。');
	});

	it('handles an empty emoji list', async () => {
		vi.mocked(slack.webClient.emoji.list).mockResolvedValueOnce({ok: true, emoji: {}});
		await send('絵文字当てクイズ');
		expect(posts().at(-1).text).toBe('出題できる絵文字がありません。');
	});

	it.each([true, false])('uses the expected icon on every quiz message (blob-thinking registered: %s)', async (registered) => {
		vi.mocked(slack.webClient.emoji.list).mockResolvedValue({
			ok: true,
			emoji: {
				test_emoji: 'https://slack.example/test_emoji.png',
				...(registered ? {'blob-thinking': 'alias:test_emoji'} : {}),
			},
		});
		await send('絵文字当てクイズ');
		await send('絵文字当てクイズ');
		await send('wrong', {thread_ts: slack.fakeTimestamp});
		await send('test_emoji', {thread_ts: slack.fakeTimestamp});
		await send('絵文字当てクイズ');
		await vi.advanceTimersByTimeAsync(60_000);
		vi.mocked(axios.get).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(posts()).toHaveLength(7);
		for (const post of posts()) {
			expect(post).toMatchObject({icon_emoji: registered ? ':blob-thinking:' : ':hugging_face:'});
		}
	});

	it('uses the fallback icon when the emoji list cannot be loaded', async () => {
		vi.mocked(slack.webClient.emoji.list).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(posts()[0]).toMatchObject({icon_emoji: ':hugging_face:'});
	});

	it.each(['list', 'download', 'upload', 'post'])('can retry after a %s failure', async (stage) => {
		if (stage === 'list') vi.mocked(slack.webClient.emoji.list).mockRejectedValueOnce(new Error('failed'));
		if (stage === 'download') vi.mocked(axios.get).mockRejectedValueOnce(new Error('failed'));
		if (stage === 'upload') vi.mocked(cloudinary.uploader.upload_stream).mockImplementationOnce(() => { throw new Error('failed'); });
		if (stage === 'post') vi.mocked(slack.webClient.chat.postMessage).mockRejectedValueOnce(new Error('failed'));
		await send('絵文字当てクイズ');
		expect(posts().at(-1).text).toContain('クイズを開始できませんでした。');
		await send('絵文字当てクイズ');
		expect(posts().at(-1)).toHaveProperty('blocks');
	});
});
