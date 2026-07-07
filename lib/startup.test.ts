import Fastify from 'fastify';
import SlackMock from './slackMock';
import {allBots} from './bots';
import {EventEmitter} from 'events';

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

// 各プラグインのテストで慣例的に行われているのと同様、実クライアント/実DBに
// 接続する共有シングルトンをモック化する。これらは plugin.default(slack) /
// plugin.server(slack) に渡す SlackMock とは独立しており、モックしても
// Fastify登録クラスのクラッシュ検知という本テストの目的には影響しない。
//
// lib/discord.ts はガード無しでモジュール読み込み時に
// discord.login(process.env.TSGBOT_DISCORD_TOKEN) を実行するため、
// 実トークンが環境変数にあると本テストが実際にDiscordへログインしてしまう。
// factory無しの automock はモック生成のために実モジュールを一度requireして
// しまい副作用(実ログイン)を防げないため、実モジュールを読み込まない
// factoryを明示的に渡す。
vi.mock('./discord', () => {
	const emitter = new EventEmitter();
	const chainable: any = new Proxy(() => chainable, {
		get: () => chainable,
	});
	return {
		default: new Proxy(emitter, {
			get(target: any, prop, receiver) {
				if (prop === 'isReady') {
					return () => false;
				}
				if (prop in target || typeof prop === 'symbol') {
					return Reflect.get(target, prop, receiver);
				}
				return chainable;
			},
		}),
	};
});
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
// lib/mailgun.ts はモジュール読み込み時に無条件で mailgun.client({username, key})
// を実行するが、mailgun.js は username が無いと即座に例外を投げる。開発環境の
// 実行時は .env 経由で値が入っているため気づきにくいが、CIのようにこれらの
// 環境変数が未設定の環境では起動時クラッシュになるため、既存の
// mail-hook/index.test.ts と同様にモックする。
vi.mock('./mailgun', () => ({
	__esModule: true,
	default: {
		client: vi.fn(),
	},
}));
// hayaoshi/jantama等、複数のプラグインがGoogle Sheets連携にgoogleapisを使う。
// 実認証情報が無くても内部で非同期の認証情報探索が走り、そのタイミング次第で
// 無関係な後続テストの失敗として現れることを確認したため、まとめてモックする。
vi.mock('googleapis');
vi.mock('../achievements');
// slack-log は default() 内で無条件に slack-log API へ axios.get() する。
// 共有axiosモック(空文字列応答)を使い、実ネットワーク接続の
// ECONNREFUSEDによる失敗を防ぐ。
vi.mock('axios');

// autogen-quiz, city-symbol 等、一部のプラグインが誤って自モジュール内で
// `import 'dotenv/config'` を実行しており、テスト中に .env の実際の
// シークレットが process.env に読み込まれてしまう。多重の安全策として無効化する。
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
	// anime/index.js, hangman/index.js は未TypeScript化のCJSモジュールで、
	// 拡張子なしで '../lib/*' 配下の.tsファイルをrequireしている。
	// vite-nodeがこれらのファイルをネイティブCJSとして扱う場合、Node標準の
	// 拡張子解決(.ts非対応)でMODULE_NOT_FOUNDになる。tsgoでのビルド後
	// (.build配下は全て.js化される)は問題なく動作するため実害はないが、
	// vitestの開発/テスト実行環境固有の制約として対象外とする。
	// (qrcode-quizはhangmanを、anime/anisonはanime/index.jsをそれぞれ
	// importするため、同じ理由で連鎖的に失敗する)
	'anime',
	'anime/anison',
	'hangman',
	'qrcode-quiz',
]);

const testedBots = allBots.filter((name) => !EXCLUDED_BOTS.has(name));

// PR #1215 (FST_ERR_PLUGIN_INVALID_ASYNC_HANDLER) のように、実際に
// fastify.register() するまで顕在化しない起動時クラッシュを検知するためのテスト。
// SlackMock だけを使う通常のユニットテストはこのクラスの不具合を検知できない。
describe.each(testedBots)('%s', (name) => {
	it('loads without throwing', async () => {
		const slack = new SlackMock();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		process.env.CHANNEL_GAMES = slack.fakeChannel;
		// nmpz はモジュール読み込み時に GOOGLE_MAPS_API_KEY / CLOUDINARY_URL の
		// 存在を無条件にチェックし、無ければ即座にthrowする。
		process.env.GOOGLE_MAPS_API_KEY ||= 'dummy-google-maps-api-key';
		process.env.CLOUDINARY_URL ||= 'cloudinary://dummy:dummy@dummy';

		const plugin = await import(`../${name}`);

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
