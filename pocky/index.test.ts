import axios from 'axios';
import pocky from './index.js';
import Slack from '../lib/slackMock';
import * as quizModule from './quiz';

vi.mock('axios');
vi.mock('../achievements');
vi.mock('../lib/slack');
vi.mock('../lib/slackUtils');
vi.mock('../lib/state');
vi.mock('../lib/openai');

let slack: InstanceType<typeof Slack> = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await pocky(slack);
});

describe('pocky', () => {
	it('responds to "ほげ?"', async () => {
		(axios as any).response = {data: [null, ['ほげ ふが']]};
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
