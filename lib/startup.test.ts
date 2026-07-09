import path from 'path';
import {fileURLToPath} from 'url';
import Fastify from 'fastify';
import SlackMock from './slackMock.js';
import {allBots, resolveBotEntryPath} from './bots.js';
import {EventEmitter} from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

vi.setConfig({testTimeout: 60 * 1000});

// atcoder/google-calendar等、複数のプラグインが default() 内で
// setInterval や node-schedule の scheduleJob(内部的にsetTimeoutを使用)で
// 定期実行ジョブを登録する。setTimeout/setIntervalのみをフェイク化することで
// テスト実行中にこれらのコールバックが実際に発火することはなくなり、非同期の
// unhandled rejectionによる無関係なテストの汚染を防げる。
// Dateまでフェイク化するとwinstonのタイムスタンプ生成(logform)や
// node-scheduleのJob生成が `toISOString is not a function` で
// クラッシュするため、toFakeで対象を限定する。
vi.useFakeTimers({toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']});
afterAll(() => {
	vi.useRealTimers();
});

vi.mock('./discord', () => ({
	default: new EventEmitter(),
}));
vi.mock('./slack', () => ({
	webClient: {},
	eventClient: {},
	messageClient: {},
	tsgEventClient: {},
	getTokens: async (): Promise<unknown[]> => [],
}));
vi.mock('./openai');
vi.mock('./firestore');
vi.mock('./state');
vi.mock('./mailgun', () => ({
	__esModule: true,
	default: {
		client: vi.fn(),
	},
}));
vi.mock('../achievements');
// dajare/tokenize.js がモジュール読み込み時に無条件で lib/getReading.js の
// getReading() を呼び出す。辞書ファイル(lib/bep-ss-2.3/bep-eng.dic)が
// 存在しない環境(CI等)では http://www.argv.org から実際にtarballを
// ダウンロードしようとして失敗する。lib/__mocks__/getReading.js の
// 既存の手動モックを使うことでこれを防ぐ。
vi.mock('../lib/getReading');
vi.mock('googleapis');
vi.mock('axios');
vi.mock('dotenv/config', () => ({}));

const EXCLUDED_BOTS = new Set([
	// default() が起動直後に updateAll() で複数のCTFプラットフォームを
	// 未awaitのままスクレイピングし始める。共有axiosモックの空文字列応答では
	// cheerioのHTMLパースが失敗し、そのタイミング次第で無関係な後続テストの
	// 失敗として現れるため除外する。
	'pwnyaa',
	// 非production環境では default() 内で job(slack) を無条件かつ未awaitで
	// 呼び出し、Google Drive APIから前日のログZIPを取得しようとする。
	// googleapisの自動モックではコールバックが実際のAPIレスポンス形状を
	// 満たさず、非同期に unhandled rejection を発生させ、そのタイミング次第で
	// 無関係な後続テストの失敗として現れるため除外する。
	'summary',
]);

const testedBots = allBots.filter((name) => !EXCLUDED_BOTS.has(name));

describe.each(testedBots)('%s', (name) => {
	it('loads without throwing', async () => {
		const slack = new SlackMock();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		process.env.CHANNEL_GAMES = slack.fakeChannel;

		// nmpz
		process.env.GOOGLE_MAPS_API_KEY ||= 'dummy-google-maps-api-key';
		process.env.CLOUDINARY_URL ||= 'cloudinary://dummy:dummy@dummy';

		const plugin = await import(resolveBotEntryPath(projectRoot, name, '../'));

		if (typeof plugin.default === 'function') {
			await plugin.default(slack);
		}

		if (typeof plugin.server === 'function') {
			const fastify = Fastify();
			try {
				await fastify.register(plugin.server(slack));
				await fastify.ready();
			} finally {
				await fastify.close();
			}
		}
	});
});
